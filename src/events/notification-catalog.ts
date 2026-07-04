import { ChannelType } from '../notifications/notification.enums';
import { EmailAttachment } from '../channels/channel.interface';
import { formatCop } from '../common/format.util';
import { ConsumedEvents } from './event-patterns';
import {
  UserRegisteredPayload,
  UserProfileUpdatedPayload,
  UserDeactivatedPayload,
  UserRoleChangedPayload,
  StoreCreatedPayload,
  StoreUpdatedPayload,
  StoreTemporarilyClosedPayload,
  StoreStaffChangedPayload,
} from './payloads/identity.payloads';
import {
  OrderCreatedPayload,
  OrderConfirmedPayload,
  OrderCancelledPayload,
  OrderStatusChangedPayload,
  ChatMessageSentPayload,
} from './payloads/order.payloads';
import {
  QrGeneratedPayload,
  DeliveryConfirmedPayload,
  QrExpiredPayload,
  DeliveryFailedPayload,
} from './payloads/fulfillment.payloads';
import {
  WalletTopupApprovedPayload,
  WalletTopupFailedPayload,
  PaymentProcessedPayload,
  PaymentFailedPayload,
  PaymentReleasedPayload,
  RefundIssuedPayload,
} from './payloads/financial.payloads';
import { LowStockAlertPayload } from './payloads/product.payloads';

/**
 * Resultado de mapear un evento de negocio a una notificación. Indica a quién va
 * dirigida (a un usuario directamente, o a la tienda —cuyo dueño se resuelve luego—),
 * el contenido renderizado y los canales por los que enviarla.
 */
export interface BuiltNotification {
  audience: 'user' | 'store';
  /** id de usuario destino cuando audience = 'user'. */
  userId?: string;
  /** id de tienda cuando audience = 'store' (el dueño se resuelve en el servicio). */
  storeId?: string;
  type: string;
  title: string;
  body: string;
  channels: ChannelType[];
  data?: Record<string, unknown>;
  /**
   * URL pública de una imagen a adjuntar en el mensaje (WhatsApp la descarga y la usa `body`
   * como caption). P. ej. el QR de retiro o el comprobante de entrega.
   */
  imageUrl?: string;
  /** Adjuntos de correo (p. ej. el comprobante de pago). No se persisten en la notificación. */
  attachments?: EmailAttachment[];
  /** Semilla para la clave de idempotencia si el evento no trae `idempotencyKey`. */
  dedupSeed: string;
}

type Builder = (payload: any) => BuiltNotification | null;

/** Normaliza el comprobante que adjunta Financial a la lista de adjuntos del correo. */
function receiptToAttachments(receipt?: {
  filename?: string;
  contentType?: string;
  contentBase64?: string;
}): EmailAttachment[] | undefined {
  if (!receipt?.contentBase64) return undefined;
  return [
    {
      filename: receipt.filename ?? 'comprobante.pdf',
      contentType: receipt.contentType ?? 'application/pdf',
      contentBase64: receipt.contentBase64,
    },
  ];
}

const { EMAIL, WHATSAPP, SMS, REALTIME } = ChannelType;

/**
 * Catálogo de notificaciones: por cada routing key define cómo construir la
 * notificación (destinatario, texto y canales). Criterio de canales:
 *
 *  - Bienvenidas/seguridad: EMAIL + REALTIME
 *  - Transacciones críticas (orden, pago, entrega): EMAIL + WHATSAPP + REALTIME
 *  - Cambios de estado de orden: WHATSAPP + REALTIME (urgentes pero no requieren email)
 *  - QR de entrega: EMAIL + WHATSAPP (el usuario necesita el código en el móvil)
 *  - Chat: solo REALTIME (es comunicación interna de la app)
 *  - Alertas al vendedor: EMAIL + WHATSAPP + REALTIME
 *
 * Agregar una notificación nueva en el futuro es añadir una entrada aquí; no hay que
 * tocar el consumidor ni el orquestador.
 */
export const NotificationCatalog: Record<string, Builder> = {
  // ---------------------------------------------------------------- Identity
  [ConsumedEvents.USER_REGISTERED]: (p: UserRegisteredPayload) => ({
    audience: 'user',
    userId: p.userId,
    type: 'user.welcome',
    title: '¡Bienvenido a ECIExpress!',
    body: `Hola ${p.fullName ?? ''}, tu cuenta fue creada con éxito. Ya puedes comprar y vender en el marketplace de la Escuela Colombiana de Ingeniería.`.trim(),
    channels: [EMAIL, REALTIME],
    data: { userId: p.userId },
    dedupSeed: p.userId,
  }),

  [ConsumedEvents.STORE_CREATED]: (p: StoreCreatedPayload) => {
    if (!p.ownerId) return null;
    return {
      audience: 'user',
      userId: p.ownerId,
      type: 'store.welcome',
      title: 'Tu tienda está lista',
      body: `La tienda "${p.name ?? ''}" fue registrada en ECIExpress. Ya puedes publicar productos y recibir pedidos.`,
      channels: [EMAIL, REALTIME],
      data: { storeId: p.storeId },
      dedupSeed: p.storeId,
    };
  },

  [ConsumedEvents.USER_PROFILE_UPDATED]: (p: UserProfileUpdatedPayload) => ({
    audience: 'user',
    userId: p.userId,
    type: 'user.profile_updated',
    title: 'Actualizamos los datos de tu cuenta',
    body: `Se modificaron los datos de tu cuenta de ECIExpress. Si no fuiste tú, contacta a soporte cuanto antes.`,
    channels: [EMAIL, REALTIME],
    data: { userId: p.userId, changedFields: p.changedFields },
    dedupSeed: p.userId,
  }),

  [ConsumedEvents.USER_DEACTIVATED]: (p: UserDeactivatedPayload) => {
    const suspended = p.reason === 'SUSPENDED';
    return {
      audience: 'user',
      userId: p.userId,
      type: 'user.deactivated',
      title: suspended ? 'Tu cuenta fue suspendida' : 'Tu cuenta fue desactivada',
      body: suspended
        ? 'Tu cuenta de ECIExpress fue suspendida temporalmente. Si crees que es un error, comunícate con soporte.'
        : 'Tu cuenta de ECIExpress fue desactivada. Si quieres reactivarla, comunícate con soporte.',
      channels: [EMAIL, REALTIME],
      data: { userId: p.userId, reason: p.reason },
      dedupSeed: `${p.userId}:deactivated:${p.reason ?? ''}`,
    };
  },

  [ConsumedEvents.USER_ROLE_CHANGED]: (p: UserRoleChangedPayload) => {
    const assigned = p.action !== 'revoked';
    const roleLabel = p.roleName ?? 'un rol';
    return {
      audience: 'user',
      userId: p.userId,
      type: 'user.role_changed',
      title: assigned ? 'Tienes un nuevo rol' : 'Se actualizó tu rol',
      body: assigned
        ? `Ahora tienes el rol "${roleLabel}" en ECIExpress. Revisa las nuevas opciones disponibles en tu cuenta.`
        : `Se retiró el rol "${roleLabel}" de tu cuenta de ECIExpress.`,
      channels: [EMAIL, WHATSAPP, REALTIME],
      data: { userId: p.userId, roleId: p.roleId, action: p.action },
      dedupSeed: `${p.userId}:role:${p.roleId ?? roleLabel}:${p.action ?? ''}`,
    };
  },

  [ConsumedEvents.STORE_STATUS_CHANGED]: (p: StoreUpdatedPayload) => {
    const status = p.newStatus ?? p.status;
    return {
      audience: 'store',
      storeId: p.storeId,
      type: 'store.status_changed',
      title: 'El estado de tu tienda cambió',
      body: `El estado de tu tienda cambió a: ${status ?? 'actualizado'}${p.reason ? ` (${p.reason})` : ''}.`,
      channels: [EMAIL, WHATSAPP, REALTIME],
      data: { storeId: p.storeId, status, reason: p.reason },
      dedupSeed: `${p.storeId}:status:${status ?? ''}`,
    };
  },

  [ConsumedEvents.STORE_TEMPORARILY_CLOSED]: (p: StoreTemporarilyClosedPayload) => ({
    audience: 'store',
    storeId: p.storeId,
    type: 'store.temporarily_closed',
    title: 'Se programó un cierre temporal de tu tienda',
    body: `Tu tienda tiene un cierre temporal programado${p.startsAt ? ` desde el ${p.startsAt}` : ''}${p.endsAt ? ` hasta el ${p.endsAt}` : ''}${p.reason ? `. Motivo: ${p.reason}` : ''}.`,
    channels: [EMAIL, REALTIME],
    data: {
      storeId: p.storeId,
      closureId: p.closureId,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
    },
    dedupSeed: p.closureId ?? `${p.storeId}:closure`,
  }),

  [ConsumedEvents.STORE_STAFF_CHANGED]: (p: StoreStaffChangedPayload) => {
    if (!p.userId) return null;
    const assigned = p.action !== 'removed';
    return {
      audience: 'user',
      userId: p.userId,
      type: 'store.staff_changed',
      title: assigned ? 'Te asignaron a un punto de venta' : 'Te retiraron de un punto de venta',
      body: assigned
        ? 'Fuiste asignado como vendedor de un punto de venta en ECIExpress. Ya puedes gestionar sus pedidos.'
        : 'Fuiste retirado como vendedor de un punto de venta en ECIExpress.',
      channels: [EMAIL, WHATSAPP, REALTIME],
      data: { storeId: p.storeId, action: p.action },
      dedupSeed: `${p.storeId}:staff:${p.userId}:${p.action ?? ''}`,
    };
  },

  // ------------------------------------------------------------------- Order
  [ConsumedEvents.ORDER_CREATED]: (p: OrderCreatedPayload) => ({
    audience: 'user',
    userId: p.buyerId,
    type: 'order.created',
    title: 'Pedido creado',
    body: `Tu pedido ${p.orderId} fue creado${p.totalAmount ? ` por ${formatCop(p.totalAmount)}` : ''} y está pendiente de pago.`,
    channels: [EMAIL, WHATSAPP, REALTIME],
    data: { orderId: p.orderId },
    dedupSeed: p.orderId,
  }),

  // Sin notificación propia: la confirmación del pedido se comunica con UN solo mensaje que
  // lleva el QR de retiro (ver `fulfillment.qr.generated`, que Fulfillment emite justo al
  // confirmarse). Evita el doble aviso "pedido confirmado" + "tu QR" en el mismo instante.
  [ConsumedEvents.ORDER_CONFIRMED]: (_p: OrderConfirmedPayload) => null,

  [ConsumedEvents.ORDER_CANCELLED]: (p: OrderCancelledPayload) => ({
    audience: 'user',
    userId: p.buyerId,
    type: 'order.cancelled',
    title: 'Pedido cancelado',
    body: `Tu pedido ${p.orderId} fue cancelado. Si pagaste con tu billetera, el saldo será reintegrado.`,
    channels: [EMAIL, WHATSAPP, REALTIME],
    data: { orderId: p.orderId },
    dedupSeed: p.orderId,
  }),

  // Sin notificación por cada cambio de estado: el front ya muestra la línea de tiempo del
  // pedido, así que no se satura al usuario con un mensaje por transición. Los dos momentos que
  // sí generan mensaje —CONFIRMED y DELIVERED— los cubren eventos propios de Fulfillment con su
  // imagen: `fulfillment.qr.generated` (QR al confirmar) y `fulfillment.delivery.confirmed`
  // (comprobante al entregar). El resto de estados no notifica.
  [ConsumedEvents.ORDER_STATUS_CHANGED]: (_p: OrderStatusChangedPayload) => null,

  [ConsumedEvents.CHAT_MESSAGE_SENT]: (p: ChatMessageSentPayload) => ({
    audience: 'user',
    userId: p.recipientId,
    type: 'chat.message',
    title: 'Nuevo mensaje',
    body: p.preview
      ? `Tienes un nuevo mensaje: "${p.preview}"`
      : 'Tienes un nuevo mensaje en tu chat de ECIExpress.',
    // El chat es comunicación interna de la app; solo notificación en tiempo real.
    channels: [REALTIME],
    data: { conversationId: p.conversationId, messageId: p.messageId },
    dedupSeed: p.messageId ?? `${p.conversationId}:${Date.now()}`,
  }),

  // ------------------------------------------------------------- Fulfillment
  // Mensaje ÚNICO de confirmación del pedido: Fulfillment emite este evento justo al confirmarse
  // (genera el código de retiro). Un solo WhatsApp con la imagen del QR y el texto de confirmación
  // como caption; también correo e in-app. Sustituye al aviso genérico "pedido confirmado".
  [ConsumedEvents.QR_GENERATED]: (p: QrGeneratedPayload) => ({
    audience: 'user',
    userId: p.buyerId,
    type: 'order.confirmed',
    title: '¡Pedido confirmado!',
    body: `Tu pedido ${p.orderId} fue confirmado. Presenta este código QR en la tienda para recibirlo${p.shortCode ? ` o dicta el código ${p.shortCode}` : ''}.`,
    channels: [EMAIL, WHATSAPP, REALTIME],
    imageUrl: p.imageUrl ?? p.qrCode,
    data: { orderId: p.orderId, qrCode: p.qrCode, shortCode: p.shortCode, expiresAt: p.expiresAt },
    dedupSeed: p.orderId,
  }),

  // Mensaje de entrega: un solo WhatsApp con el comprobante genérico (imagen con el ID del pedido
  // impreso) y el texto como caption; también correo e in-app.
  [ConsumedEvents.DELIVERY_CONFIRMED]: (p: DeliveryConfirmedPayload) => ({
    audience: 'user',
    userId: p.buyerId,
    type: 'delivery.confirmed',
    title: 'Entrega confirmada',
    body: `Confirmamos la entrega de tu pedido ${p.orderId}. ¡Gracias por comprar en ECIExpress!`,
    channels: [EMAIL, WHATSAPP, REALTIME],
    imageUrl: p.imageUrl,
    data: { orderId: p.orderId },
    dedupSeed: p.orderId,
  }),

  [ConsumedEvents.QR_EXPIRED]: (p: QrExpiredPayload) => ({
    audience: 'user',
    userId: p.buyerId,
    type: 'delivery.qr_expired',
    title: 'Tu código de entrega venció',
    body: `El código QR del pedido ${p.orderId} venció sin usarse. Genera uno nuevo desde la app para completar la entrega.`,
    channels: [EMAIL, WHATSAPP, REALTIME],
    data: { orderId: p.orderId },
    dedupSeed: p.orderId,
  }),

  [ConsumedEvents.DELIVERY_FAILED]: (p: DeliveryFailedPayload) => ({
    audience: 'user',
    userId: p.buyerId,
    type: 'delivery.failed',
    title: 'No pudimos completar tu entrega',
    body: `Hubo un problema entregando tu pedido ${p.orderId}${p.reason ? `: ${p.reason}` : ''}. Te contactaremos para reprogramar.`,
    channels: [EMAIL, WHATSAPP, REALTIME],
    data: { orderId: p.orderId, reason: p.reason },
    dedupSeed: p.orderId,
  }),

  // --------------------------------------------------------------- Financial
  [ConsumedEvents.WALLET_TOPUP_APPROVED]: (p: WalletTopupApprovedPayload) => {
    if (!p.userId) return null;
    return {
      audience: 'user',
      userId: p.userId,
      type: 'wallet.topup_approved',
      title: 'Recarga confirmada',
      body: `Tu billetera fue recargada por ${formatCop(p.amount)}.`,
      channels: [EMAIL, WHATSAPP, SMS, REALTIME],
      data: { topupId: p.topupId, amount: p.amount },
      // Comprobante de la recarga adjunto al correo.
      attachments: receiptToAttachments(p.receipt),
      dedupSeed: p.topupId ?? p.userId,
    };
  },

  [ConsumedEvents.WALLET_TOPUP_FAILED]: (p: WalletTopupFailedPayload) => {
    if (!p.userId) return null;
    return {
      audience: 'user',
      userId: p.userId,
      type: 'wallet.topup_failed',
      title: 'Hubo un error al procesar tu recarga',
      body: `No pudimos procesar tu recarga por ${formatCop(p.amount)}${p.paymentMethod ? ` con ${p.paymentMethod}` : ''}. Intenta de nuevo o usa otro medio de pago.`,
      channels: [EMAIL, WHATSAPP, REALTIME],
      data: {
        topupId: p.topupId,
        amount: p.amount,
        paymentMethod: p.paymentMethod,
        reason: p.reason,
      },
      dedupSeed: p.topupId ? `${p.topupId}:failed` : `${p.userId}:topup_failed`,
    };
  },

  [ConsumedEvents.PAYMENT_PROCESSED]: (p: PaymentProcessedPayload) => {
    if (!p.userId) return null;
    return {
      audience: 'user',
      userId: p.userId,
      type: 'payment.processed',
      title: 'Pago exitoso',
      body: `Se procesó el pago${p.totalCharged ? ` de ${formatCop(p.totalCharged)}` : ''} de tu pedido ${p.orderId}.`,
      // Se añade EMAIL para enviar el comprobante de pago del pedido.
      channels: [EMAIL, WHATSAPP, REALTIME],
      data: { orderId: p.orderId, totalCharged: p.totalCharged },
      // Comprobante del pago adjunto al correo.
      attachments: receiptToAttachments(p.receipt),
      dedupSeed: p.orderId,
    };
  },

  [ConsumedEvents.PAYMENT_FAILED]: (p: PaymentFailedPayload) => {
    if (!p.userId) return null;
    return {
      audience: 'user',
      userId: p.userId,
      type: 'payment.failed',
      title: 'No pudimos procesar tu pago',
      body: `El pago de tu pedido ${p.orderId} no pudo completarse${p.reason === 'INSUFFICIENT_FUNDS' ? ' por saldo insuficiente en tu billetera' : ''}.`,
      channels: [EMAIL, WHATSAPP, REALTIME],
      data: { orderId: p.orderId, reason: p.reason },
      dedupSeed: `${p.orderId}:failed`,
    };
  },

  [ConsumedEvents.PAYMENT_RELEASED]: (p: PaymentReleasedPayload) => ({
    audience: 'store',
    storeId: p.storeId,
    type: 'payout.released',
    title: 'Pago liberado',
    body: `Se liberó el pago${p.storePayoutAmount ? ` de ${formatCop(p.storePayoutAmount)}` : ''} por el pedido ${p.orderId} tras confirmarse la entrega.`,
    channels: [EMAIL, WHATSAPP, REALTIME],
    data: { orderId: p.orderId, storePayoutAmount: p.storePayoutAmount },
    dedupSeed: `${p.orderId}:released`,
  }),

  [ConsumedEvents.REFUND_ISSUED]: (p: RefundIssuedPayload) => {
    if (!p.userId) return null;
    return {
      audience: 'user',
      userId: p.userId,
      type: 'refund.issued',
      title: 'Reembolso procesado',
      body: `Reintegramos${p.refundedAmount ? ` ${formatCop(p.refundedAmount)}` : ' el valor'} de tu pedido ${p.orderId} a tu billetera.`,
      channels: [EMAIL, WHATSAPP, REALTIME],
      data: { orderId: p.orderId, refundedAmount: p.refundedAmount },
      dedupSeed: `${p.orderId}:refund`,
    };
  },

  // ----------------------------------------------------------------- Product
  [ConsumedEvents.LOW_STOCK_ALERT]: (p: LowStockAlertPayload) => {
    // Disponible real = stock total menos lo reservado en carritos/órdenes sin confirmar.
    const available = p.stock - p.reservedStock;
    return {
      audience: 'store',
      storeId: p.storeId,
      type: 'inventory.low_stock',
      title: 'Stock bajo',
      body: `El producto "${p.name ?? p.productId}" está por agotarse (quedan ${available}, mínimo ${p.minStock}). Reabastécelo para no perder ventas.`,
      channels: [EMAIL, WHATSAPP, REALTIME],
      data: {
        productId: p.productId,
        name: p.name,
        available,
        stock: p.stock,
        reservedStock: p.reservedStock,
        minStock: p.minStock,
      },
      dedupSeed: `${p.productId}:low_stock`,
    };
  },
};

/** Routing keys que tienen una notificación asociada. */
export function isCatalogued(routingKey: string): boolean {
  return routingKey in NotificationCatalog;
}
