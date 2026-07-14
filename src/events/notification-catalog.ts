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

/** Referencia legible del pedido para mostrar al usuario: el número visible si existe,
 *  o una versión abreviada del UUID (primeros 8 caracteres). */
function orderRef(orderNumber?: string, orderId?: string): string {
  if (orderNumber) return orderNumber;
  if (orderId) return `#${orderId.slice(0, 8)}`;
  return '';
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
  // Sin notificación: el aviso "pedido creado / pendiente de pago" se consideró ruido
  // (llega antes de que el pedido siquiera se confirme). El usuario recibe primero el
  // "Pago exitoso" (financial.payment.processed) y luego la confirmación con el QR de
  // retiro (fulfillment.qr.generated). No se notifica la creación por ningún canal.
  [ConsumedEvents.ORDER_CREATED]: (_p: OrderCreatedPayload) => null,

  // Confirmación del pedido: mensaje independiente del QR (Fulfillment a veces falla o se
  // retrasa). El QR de retiro llega en `fulfillment.qr.generated` como segundo mensaje.
  [ConsumedEvents.ORDER_CONFIRMED]: (p: OrderConfirmedPayload) => ({
    audience: 'user',
    userId: p.buyerId,
    type: 'order.confirmed',
    title: '¡Pedido confirmado!',
    body: `Tu pedido ${orderRef(p.orderNumber, p.orderId)} fue confirmado. Te notificaremos cuando el código de retiro esté listo.`,
    channels: [EMAIL, WHATSAPP, REALTIME],
    data: { orderId: p.orderId, orderNumber: p.orderNumber, storeId: p.storeId, pickupExpiresAt: p.pickupExpiresAt },
    dedupSeed: p.orderId,
  }),

  [ConsumedEvents.ORDER_CANCELLED]: (p: OrderCancelledPayload) => ({
    audience: 'user',
    userId: p.buyerId,
    type: 'order.cancelled',
    title: 'Pedido cancelado',
    body: `Tu pedido ${orderRef(p.orderNumber, p.orderId)} fue cancelado. Si pagaste con tu billetera, el saldo será reintegrado.`,
    channels: [EMAIL, WHATSAPP, REALTIME],
    data: { orderId: p.orderId, orderNumber: p.orderNumber },
    dedupSeed: p.orderId,
  }),

  // Sin notificación por cada cambio de estado: el front ya muestra la línea de tiempo del
  // pedido, así que no se satura al usuario con un mensaje por transición. CONFIRMED se notifica
  // desde `order.order.confirmed` y el QR desde `fulfillment.qr.generated`. DELIVERED se
  // notifica desde `fulfillment.delivery.confirmed`. El resto de estados no notifica.
  [ConsumedEvents.ORDER_STATUS_CHANGED]: (_p: OrderStatusChangedPayload) => null,

  // Ya NO genera notificación (ni siquiera en tiempo real): un mensaje nuevo se ve como
  // contador de no-leídos en la propia burbuja de mensajes (orders-service lo empuja por
  // WebSocket a `user:<id>` vía `conversation:updated`), no como entrada en la campana.
  [ConsumedEvents.CHAT_MESSAGE_SENT]: (_p: ChatMessageSentPayload) => null,

  // ------------------------------------------------------------- Fulfillment
  // QR de retiro listo: segundo mensaje después de la confirmación. Lleva la imagen del QR
  // y el código corto para dictar en tienda.
  [ConsumedEvents.QR_GENERATED]: (p: QrGeneratedPayload) => ({
    audience: 'user',
    userId: p.buyerId,
    type: 'pickup.qr_ready',
    title: 'Código de retiro listo',
    body: `Tu código QR para retirar el pedido ${orderRef(p.orderNumber, p.orderId)} ya está listo. Preséntalo en la tienda${p.shortCode ? ` o dicta el código ${p.shortCode}` : ''} para recibir tu compra.`,
    channels: [EMAIL, WHATSAPP, REALTIME],
    imageUrl: p.imageUrl ?? p.qrCode,
    data: { orderId: p.orderId, orderNumber: p.orderNumber, qrCode: p.qrCode, shortCode: p.shortCode, expiresAt: p.expiresAt },
    dedupSeed: p.orderId,
  }),

  // Mensaje de entrega: un solo WhatsApp con el comprobante genérico (imagen con el ID del pedido
  // impreso) y el texto como caption; también correo e in-app.
  [ConsumedEvents.DELIVERY_CONFIRMED]: (p: DeliveryConfirmedPayload) => ({
    audience: 'user',
    userId: p.buyerId,
    type: 'delivery.confirmed',
    title: 'Entrega confirmada',
    body: `Confirmamos la entrega de tu pedido ${orderRef(p.orderNumber, p.orderId)}. ¡Gracias por comprar en ECIExpress!`,
    channels: [EMAIL, WHATSAPP, REALTIME],
    imageUrl: p.imageUrl,
    data: { orderId: p.orderId, orderNumber: p.orderNumber, imageUrl: p.imageUrl ?? '' },
    dedupSeed: p.orderId,
  }),

  [ConsumedEvents.QR_EXPIRED]: (p: QrExpiredPayload) => ({
    audience: 'user',
    userId: p.buyerId,
    type: 'delivery.qr_expired',
    title: 'Tu código de entrega venció',
    body: `El código QR del pedido ${orderRef(p.orderNumber, p.orderId)} venció — producto no reclamado. Si crees que hay un error, comunícate con la tienda.`,
    channels: [EMAIL, WHATSAPP, REALTIME],
    data: { orderId: p.orderId, orderNumber: p.orderNumber },
    dedupSeed: p.orderId,
  }),

  [ConsumedEvents.DELIVERY_FAILED]: (p: DeliveryFailedPayload) => ({
    audience: 'user',
    userId: p.buyerId,
    type: 'delivery.failed',
    title: 'No pudimos completar tu entrega',
    body: `Hubo un problema entregando tu pedido ${orderRef(p.orderNumber, p.orderId)}${p.reason ? `: ${p.reason}` : ''}. Te contactaremos para reprogramar.`,
    channels: [EMAIL, WHATSAPP, REALTIME],
    data: { orderId: p.orderId, orderNumber: p.orderNumber, reason: p.reason },
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
      body: `Se procesó el pago${p.totalCharged ? ` de ${formatCop(p.totalCharged)}` : ''} de tu pedido ${orderRef(p.orderNumber, p.orderId)}.`,
      // Se añade EMAIL para enviar el comprobante de pago del pedido.
      // WHATSAPP deliberadamente NO va aquí: payment.processed y order.confirmed se disparan
      // ~2-3s seguidos para el mismo pedido, y el segundo mensaje de WhatsApp de esa ráfaga
      // fallaba de forma consistente (401 Authentication Error) mientras el primero siempre
      // pasaba. Se deja un solo WhatsApp por pedido en esta cascada (el de order.confirmed)
      // para aislar si el problema era justamente ser "el segundo mensaje".
      channels: [EMAIL, REALTIME],
      data: { orderId: p.orderId, orderNumber: p.orderNumber, totalCharged: p.totalCharged },
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
      body: `El pago de tu pedido ${orderRef(p.orderNumber, p.orderId)} no pudo completarse${p.reason === 'INSUFFICIENT_FUNDS' ? ' por saldo insuficiente en tu billetera' : ''}.`,
      channels: [EMAIL, WHATSAPP, REALTIME],
      data: { orderId: p.orderId, orderNumber: p.orderNumber, reason: p.reason },
      dedupSeed: `${p.orderId}:failed`,
    };
  },

  [ConsumedEvents.PAYMENT_RELEASED]: (p: PaymentReleasedPayload) => ({
    audience: 'store',
    storeId: p.storeId,
    type: 'payout.released',
    title: 'Pago liberado',
      body: `Se liberó el pago${p.storePayoutAmount ? ` de ${formatCop(p.storePayoutAmount)}` : ''} por el pedido ${orderRef(p.orderNumber, p.orderId)} tras confirmarse la entrega.`,
    channels: [EMAIL, WHATSAPP, REALTIME],
    data: { orderId: p.orderId, orderNumber: p.orderNumber, storePayoutAmount: p.storePayoutAmount },
    dedupSeed: `${p.orderId}:released`,
  }),

  [ConsumedEvents.REFUND_ISSUED]: (p: RefundIssuedPayload) => {
    if (!p.userId) return null;
    return {
      audience: 'user',
      userId: p.userId,
      type: 'refund.issued',
      title: 'Reembolso procesado',
      body: `Reintegramos${p.refundedAmount ? ` ${formatCop(p.refundedAmount)}` : ' el valor'} de tu pedido ${orderRef(p.orderNumber, p.orderId)} a tu billetera.`,
      channels: [EMAIL, WHATSAPP, REALTIME],
      data: { orderId: p.orderId, orderNumber: p.orderNumber, refundedAmount: p.refundedAmount },
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
