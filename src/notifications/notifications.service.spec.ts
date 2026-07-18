import { NotificationsService } from './notifications.service';
import { ChannelType, DeliveryStatus } from './notification.enums';

/**
 * Tests del orquestador centrados en idempotencia y respeto de preferencias.
 * Los repositorios y colaboradores se simulan con mocks ligeros.
 */
describe('NotificationsService', () => {
  function build(overrides: {
    existing?: any;
    channelEnabled?: boolean;
    recipient?: any;
    sendResult?: any;
  }) {
    const saved: any[] = [];
    const notifications = {
      findOne: jest.fn().mockResolvedValue(overrides.existing ?? null),
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ id: 'n1', ...x })),
      createQueryBuilder: jest.fn(),
    };
    const deliveries = {
      create: jest.fn((x) => x),
      save: jest.fn((x) => {
        saved.push(x);
        return Promise.resolve(x);
      }),
    };
    const dispatcher = {
      send: jest.fn().mockResolvedValue(
        overrides.sendResult ?? {
          status: DeliveryStatus.SENT,
          provider: 'sandbox',
        },
      ),
    };
    const recipients = {
      findRecipient: jest.fn().mockResolvedValue(overrides.recipient ?? null),
      resolveStoreOwner: jest.fn(),
    };
    const preferences = {
      isChannelEnabled: jest
        .fn()
        .mockResolvedValue(overrides.channelEnabled ?? true),
    };
    const logger = { logEvent: jest.fn(), warnEvent: jest.fn() };
    const config = { get: jest.fn().mockReturnValue('') };

    const service = new NotificationsService(
      notifications as any,
      deliveries as any,
      dispatcher as any,
      recipients as any,
      preferences as any,
      logger as any,
      config as any,
    );
    return { service, notifications, dispatcher, deliveries, saved };
  }

  it('no reprocesa si ya existe una notificación con la misma dedupKey', async () => {
    const existing = { id: 'prev', deliveries: [] };
    const { service, dispatcher, notifications } = build({ existing });

    const result = await service.dispatch({
      channels: [ChannelType.EMAIL],
      type: 'x',
      title: 't',
      body: 'b',
      dedupKey: 'dup-1',
    });

    expect(result).toBe(existing);
    expect(notifications.save).not.toHaveBeenCalled();
    expect(dispatcher.send).not.toHaveBeenCalled();
  });

  it('marca SKIPPED y no envía cuando el usuario desactivó el canal', async () => {
    const { service, dispatcher, saved } = build({
      channelEnabled: false,
      recipient: { email: 'a@b.com' },
    });

    await service.dispatch({
      recipientUserId: 'u1',
      channels: [ChannelType.EMAIL],
      type: 'x',
      title: 't',
      body: 'b',
      dedupKey: 'k1',
    });

    expect(dispatcher.send).not.toHaveBeenCalled();
    expect(saved[0].status).toBe(DeliveryStatus.SKIPPED);
    expect(saved[0].error).toBe('channel_disabled_by_user');
  });

  it('envía por el canal y persiste la entrega como SENT', async () => {
    const { service, dispatcher, saved } = build({
      channelEnabled: true,
      recipient: { email: 'a@b.com' },
    });

    await service.dispatch({
      recipientUserId: 'u1',
      channels: [ChannelType.EMAIL],
      type: 'x',
      title: 't',
      body: 'b',
      dedupKey: 'k2',
    });

    expect(dispatcher.send).toHaveBeenCalledTimes(1);
    expect(saved[0].status).toBe(DeliveryStatus.SENT);
    expect(saved[0].sentAt).toBeInstanceOf(Date);
  });

  describe('retryStaleDeliveries', () => {
    function buildForRetry(candidates: any[], sendResult?: any) {
      const saved: any[] = [];
      const qb = {
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(candidates),
      };
      const deliveries = {
        createQueryBuilder: jest.fn(() => qb),
        save: jest.fn((x) => {
          saved.push(x);
          return Promise.resolve(x);
        }),
      };
      const dispatcher = {
        send: jest.fn().mockResolvedValue(
          sendResult ?? { status: DeliveryStatus.SENT, provider: 'sandbox' },
        ),
      };
      const recipients = {
        findRecipient: jest.fn().mockResolvedValue({ phone: '+573001234567' }),
        resolveStoreOwner: jest.fn(),
      };
      const logger = { logEvent: jest.fn(), warnEvent: jest.fn() };
      const config = { get: jest.fn().mockReturnValue('') };
      const service = new NotificationsService(
        {} as any,
        deliveries as any,
        dispatcher as any,
        recipients as any,
        { isChannelEnabled: jest.fn() } as any,
        logger as any,
        config as any,
      );
      return { service, qb, dispatcher, saved };
    }

    const baseDelivery = (overrides: any = {}) => ({
      id: 'd1',
      channel: ChannelType.WHATSAPP,
      status: DeliveryStatus.FAILED,
      error: 'timeout',
      attempts: 1,
      notification: {
        id: 'n1',
        recipientUserId: 'u1',
        type: 'pickup.qr_ready',
        title: 't',
        body: 'b',
        data: {},
        imageUrl: 'https://blob/qr.png',
      },
      ...overrides,
    });

    it('reintenta y marca SENT una entrega FAILED', async () => {
      const { service, saved } = buildForRetry([baseDelivery()]);

      const result = await service.retryStaleDeliveries(30, 4);

      expect(result).toEqual({ retried: 1, succeeded: 1 });
      expect(saved[0].status).toBe(DeliveryStatus.SENT);
      expect(saved[0].attempts).toBe(2);
    });

    it('filtra con attempts < maxAttempts en la query (no reintenta indefinidamente)', async () => {
      const { service, qb } = buildForRetry([]);

      await service.retryStaleDeliveries(30, 4);

      expect(qb.andWhere).toHaveBeenCalledWith(
        'd.attempts < :maxAttempts',
        { maxAttempts: 4 },
      );
    });

    it('solo considera SKIPPED por recipient_offline, no por channel_disabled_by_user', async () => {
      const { service, qb } = buildForRetry([]);

      await service.retryStaleDeliveries(30, 4);

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('d.status = :skipped AND d.error = :retryableSkip'),
        expect.objectContaining({ retryableSkip: 'recipient_offline' }),
      );
    });

    it('pasa imageUrl de la notificación para reconstruir el mensaje (WhatsApp no pierde el QR)', async () => {
      const { service, dispatcher } = buildForRetry([baseDelivery()]);

      await service.retryStaleDeliveries(30, 4);

      expect(dispatcher.send).toHaveBeenCalledWith(
        ChannelType.WHATSAPP,
        expect.objectContaining({ imageUrl: 'https://blob/qr.png' }),
      );
    });

    it('si vuelve a fallar, actualiza el error y NO cuenta como éxito', async () => {
      const { service, saved } = buildForRetry(
        [baseDelivery()],
        { status: DeliveryStatus.FAILED, provider: 'whatsapp-cloud', error: 'still down' },
      );

      const result = await service.retryStaleDeliveries(30, 4);

      expect(result).toEqual({ retried: 1, succeeded: 0 });
      expect(saved[0].error).toBe('still down');
    });
  });
});
