import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, QueryFailedError, Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationDelivery } from './entities/notification-delivery.entity';
import { ChannelType, DeliveryStatus } from './notification.enums';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { ChannelDispatcherService } from '../channels/channel-dispatcher.service';
import { ChannelMessage, EmailAttachment } from '../channels/channel.interface';
import { RecipientsService } from '../recipients/recipients.service';
import { PreferencesService } from '../preferences/preferences.service';
import { NotificationLogger } from '../common/logger/notification.logger';
import { maskDestination } from '../common/format.util';
import { NotificationCatalog } from '../events/notification-catalog';
import { NotificationCommandPayload } from '../events/payloads/notification-command.payload';

/**
 * Petición interna de envío ya normalizada (la usan tanto el catálogo de eventos como
 * el envío directo). El orquestador resuelve contacto, preferencias y persistencia.
 */
export interface DispatchRequest {
  recipientUserId?: string | null;
  emailOverride?: string;
  phoneOverride?: string;
  channels: ChannelType[];
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  /** Adjuntos de correo. No se persisten en la notificación; solo van al canal EMAIL. */
  attachments?: EmailAttachment[] | null;
  /** URL pública de una imagen a adjuntar en el mensaje (la usa el canal WHATSAPP). */
  imageUrl?: string | null;
  sourceEvent?: string | null;
  sourceService?: string | null;
  dedupKey?: string | null;
}

/**
 * Orquestador central de notificaciones. Recibe peticiones (de eventos del bus o de
 * envíos directos), aplica idempotencia y preferencias, resuelve el destino de cada
 * canal, despacha a los proveedores y persiste el resultado de cada entrega.
 */
/** Error de SKIPPED que sí amerita reintento: el socket no estaba conectado, no que el
 *  usuario desactivó el canal (channel_disabled_by_user) — eso hay que respetarlo. */
const RETRYABLE_SKIP_REASON = 'recipient_offline';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectRepository(NotificationDelivery)
    private readonly deliveries: Repository<NotificationDelivery>,
    private readonly dispatcher: ChannelDispatcherService,
    private readonly recipients: RecipientsService,
    private readonly preferences: PreferencesService,
    private readonly logger: NotificationLogger,
  ) {}

  // ============================================================ Entradas

  /**
   * Procesa un evento de negocio del bus mapeándolo a una notificación según el
   * catálogo. Si la routing key no está en el catálogo o no aplica, no hace nada.
   */
  async handleDomainEvent(
    routingKey: string,
    payload: Record<string, any>,
  ): Promise<void> {
    const build = NotificationCatalog[routingKey];
    if (!build) {
      this.logger.logEvent(
        'event.ignored',
        'Evento sin notificación asociada',
        {
          routingKey,
        },
      );
      return;
    }

    const built = build(payload);
    if (!built) {
      this.logger.logEvent(
        'event.ignored',
        'Evento omitido (sin destinatario resoluble)',
        { routingKey },
      );
      return;
    }

    // Resolver el usuario destino: directo o el dueño de la tienda.
    let userId = built.userId ?? null;
    if (built.audience === 'store' && built.storeId) {
      userId = await this.recipients.resolveStoreOwner(built.storeId);
      if (!userId) {
        this.logger.warnEvent(
          'event.ignored',
          'No se pudo resolver el dueño de la tienda; notificación omitida',
          { routingKey, storeId: built.storeId },
        );
        return;
      }
    }

    const dedupKey =
      (payload.idempotencyKey as string | undefined) ??
      `${routingKey}:${built.dedupSeed}`;

    await this.dispatch({
      recipientUserId: userId,
      channels: built.channels,
      type: built.type,
      title: built.title,
      body: built.body,
      data: built.data,
      attachments: built.attachments,
      imageUrl: built.imageUrl,
      sourceEvent: routingKey,
      sourceService: routingKey.split('.')[0],
      dedupKey,
    });
  }

  /** Procesa el comando genérico `notification.send.requested` del bus. */
  async handleSendCommand(payload: NotificationCommandPayload): Promise<void> {
    await this.dispatch({
      recipientUserId: payload.recipientUserId ?? null,
      emailOverride: payload.email,
      phoneOverride: payload.phone,
      channels: payload.channels,
      type: payload.type ?? 'custom',
      title: payload.title,
      body: payload.body,
      data: payload.data,
      sourceEvent: 'notification.send.requested',
      sourceService: 'notification',
      dedupKey: payload.dedupKey,
    });
  }

  // ============================================================ Orquestación

  /**
   * Núcleo del envío: idempotencia, persistencia de la notificación y despacho por
   * cada canal solicitado respetando las preferencias del usuario.
   */
  async dispatch(req: DispatchRequest): Promise<Notification> {
    // 1. Idempotencia por dedupKey.
    if (req.dedupKey) {
      const existing = await this.notifications.findOne({
        where: { dedupKey: req.dedupKey },
        relations: { deliveries: true },
      });
      if (existing) {
        this.logger.logEvent('event.duplicate', 'Notificación ya procesada', {
          dedupKey: req.dedupKey,
        });
        return existing;
      }
    }

    // 2. Crear la notificación (también es la bandeja in-app).
    let notification: Notification;
    try {
      notification = await this.notifications.save(
        this.notifications.create({
          recipientUserId: req.recipientUserId ?? null,
          type: req.type,
          title: req.title,
          body: req.body,
          data: req.data ?? null,
          sourceEvent: req.sourceEvent ?? null,
          sourceService: req.sourceService ?? null,
          dedupKey: req.dedupKey ?? null,
          imageUrl: req.imageUrl ?? null,
        }),
      );
    } catch (error) {
      // Carrera: otro consumidor insertó la misma dedupKey entre el SELECT y el INSERT.
      if (error instanceof QueryFailedError && req.dedupKey) {
        const existing = await this.notifications.findOne({
          where: { dedupKey: req.dedupKey },
          relations: { deliveries: true },
        });
        if (existing) return existing;
      }
      throw error;
    }

    // 3. Cargar contacto del destinatario (si lo conocemos).
    const recipient = req.recipientUserId
      ? await this.recipients.findRecipient(req.recipientUserId)
      : null;

    // 4. Despachar por cada canal.
    const results: NotificationDelivery[] = [];
    for (const channel of req.channels) {
      results.push(
        await this.deliverChannel(notification, channel, req, recipient),
      );
    }
    notification.deliveries = results;

    this.logger.logEvent('notification.dispatched', 'Notificación despachada', {
      notificationId: notification.id,
      type: notification.type,
      channels: req.channels,
    });
    return notification;
  }

  private async deliverChannel(
    notification: Notification,
    channel: ChannelType,
    req: DispatchRequest,
    recipient: Awaited<ReturnType<RecipientsService['findRecipient']>>,
  ): Promise<NotificationDelivery> {
    const delivery = this.deliveries.create({
      notificationId: notification.id,
      channel,
      status: DeliveryStatus.PENDING,
      attempts: 0,
    });

    // Respetar preferencias del usuario (solo si hay usuario destino).
    if (req.recipientUserId) {
      const enabled = await this.preferences.isChannelEnabled(
        req.recipientUserId,
        channel,
      );
      if (!enabled) {
        delivery.status = DeliveryStatus.SKIPPED;
        delivery.error = 'channel_disabled_by_user';
        return this.deliveries.save(delivery);
      }
    }

    // Resolver el destino concreto del canal.
    const message = this.buildChannelMessage(channel, req, recipient);

    delivery.attempts = 1;
    const result = await this.dispatcher.send(channel, message);
    delivery.status = result.status;
    delivery.provider = result.provider;
    delivery.providerMessageId = result.providerMessageId ?? null;
    delivery.error = result.error ?? null;
    delivery.destination = maskDestination(
      message.destination ?? message.userId ?? null,
    );
    delivery.sentAt = result.status === DeliveryStatus.SENT ? new Date() : null;

    const event =
      result.status === DeliveryStatus.SENT
        ? 'delivery.sent'
        : result.status === DeliveryStatus.FAILED
          ? 'delivery.failed'
          : 'delivery.skipped';
    this.logger[
      result.status === DeliveryStatus.FAILED ? 'warnEvent' : 'logEvent'
    ](event, `Entrega ${channel} -> ${result.status}`, {
      notificationId: notification.id,
      channel,
      provider: result.provider,
      error: result.error,
    });

    return this.deliveries.save(delivery);
  }

  private buildChannelMessage(
    channel: ChannelType,
    req: DispatchRequest,
    recipient: Awaited<ReturnType<RecipientsService['findRecipient']>>,
  ): ChannelMessage {
    const base: ChannelMessage = {
      userId: req.recipientUserId ?? null,
      type: req.type,
      title: req.title,
      body: req.body,
      data: req.data ?? null,
      imageUrl: req.imageUrl ?? null,
    };

    switch (channel) {
      case ChannelType.EMAIL:
        return {
          ...base,
          sourceEvent: req.sourceEvent ?? null,
          recipientName: recipient?.fullName ?? null,
          destination: req.emailOverride ?? recipient?.email ?? null,
          attachments: req.attachments ?? null,
        };
      case ChannelType.WHATSAPP:
      case ChannelType.SMS:
        return {
          ...base,
          destination: req.phoneOverride ?? recipient?.phone ?? null,
        };
      case ChannelType.REALTIME:
      default:
        return base;
    }
  }

  // ============================================================ Reintentos

  /**
   * Reintenta entregas recientes que quedaron en FAILED, o en SKIPPED por
   * `recipient_offline` (el socket no estaba conectado — puede que ahora sí lo esté).
   * NO reintenta SKIPPED por `channel_disabled_by_user`: eso es una decisión del usuario,
   * no una falla transitoria. Acotado a los últimos `windowMinutes` para no revivir entregas
   * viejas, y a `maxAttempts` para no reintentar por siempre algo que sigue fallando.
   */
  async retryStaleDeliveries(
    windowMinutes: number,
    maxAttempts: number,
  ): Promise<{ retried: number; succeeded: number }> {
    const cutoff = new Date(Date.now() - windowMinutes * 60_000);
    const candidates = await this.deliveries
      .createQueryBuilder('d')
      .innerJoinAndSelect('d.notification', 'n')
      .where('d.created_at >= :cutoff', { cutoff })
      .andWhere('d.attempts < :maxAttempts', { maxAttempts })
      .andWhere(
        '(d.status = :failed OR (d.status = :skipped AND d.error = :retryableSkip))',
        {
          failed: DeliveryStatus.FAILED,
          skipped: DeliveryStatus.SKIPPED,
          retryableSkip: RETRYABLE_SKIP_REASON,
        },
      )
      .getMany();

    let succeeded = 0;
    for (const delivery of candidates) {
      const notification = delivery.notification;
      const recipient = notification.recipientUserId
        ? await this.recipients.findRecipient(notification.recipientUserId)
        : null;
      const message = this.buildChannelMessage(
        delivery.channel,
        {
          recipientUserId: notification.recipientUserId,
          channels: [delivery.channel],
          type: notification.type,
          title: notification.title,
          body: notification.body,
          data: notification.data,
          imageUrl: notification.imageUrl,
        },
        recipient,
      );

      const result = await this.dispatcher.send(delivery.channel, message);
      delivery.attempts += 1;
      delivery.status = result.status;
      delivery.provider = result.provider;
      delivery.providerMessageId = result.providerMessageId ?? null;
      delivery.error = result.error ?? null;
      delivery.destination = maskDestination(
        message.destination ?? message.userId ?? null,
      );
      if (result.status === DeliveryStatus.SENT) {
        delivery.sentAt = new Date();
        succeeded += 1;
      }
      await this.deliveries.save(delivery);

      this.logger.logEvent(
        'delivery.retried',
        `Reintento ${delivery.channel} -> ${result.status}`,
        {
          notificationId: notification.id,
          channel: delivery.channel,
          attempts: delivery.attempts,
          error: result.error,
        },
      );
    }
    return { retried: candidates.length, succeeded };
  }

  // ============================================================ Bandeja in-app

  async listForUser(
    userId: string,
    query: QueryNotificationsDto,
  ): Promise<Notification[]> {
    return this.notifications.find({
      where: {
        recipientUserId: userId,
        // Solo sin leer: IsNull() para filtrar correctamente por read_at NULL.
        ...(query.unreadOnly ? { readAt: IsNull() } : {}),
      },
      relations: { deliveries: true },
      order: { createdAt: 'DESC' },
      take: query.limit,
      skip: query.offset,
    });
  }

  unreadCount(userId: string): Promise<number> {
    return this.notifications
      .createQueryBuilder('n')
      .where('n.recipient_user_id = :userId', { userId })
      .andWhere('n.read_at IS NULL')
      .getCount();
  }

  async markRead(userId: string, id: string): Promise<Notification> {
    const notification = await this.notifications.findOne({
      where: { id, recipientUserId: userId },
      relations: { deliveries: true },
    });
    if (!notification) {
      throw new NotFoundException('Notificación no encontrada');
    }
    if (!notification.readAt) {
      notification.readAt = new Date();
      await this.notifications.save(notification);
    }
    return notification;
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.notifications
      .createQueryBuilder()
      .update(Notification)
      .set({ readAt: () => 'now()' })
      .where('recipient_user_id = :userId', { userId })
      .andWhere('read_at IS NULL')
      .execute();
    return { updated: result.affected ?? 0 };
  }
}
