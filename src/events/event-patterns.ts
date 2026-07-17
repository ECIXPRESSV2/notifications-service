/**
 * Routing keys del bus de eventos de ECIExpress que consume este servicio.
 *
 * Todos los servicios publican sobre el exchange topic compartido `eciexpress_events`.
 * El servicio de notificaciones es un consumidor final (no publica eventos de negocio):
 * se enlaza con varios prefijos comodín y reacciona a las routing keys concretas que
 * tienen una notificación asociada en el catálogo. El resto se ignora silenciosamente.
 */
export const ConsumedEvents = {
  // Identity
  USER_REGISTERED: 'identity.user.registered',
  USER_PROFILE_UPDATED: 'identity.user.profile_updated',
  USER_DEACTIVATED: 'identity.user.deactivated',
  USER_ROLE_CHANGED: 'identity.user.role_changed',
  STORE_CREATED: 'identity.store.created',
  STORE_UPDATED: 'identity.store.updated',
  STORE_STATUS_CHANGED: 'identity.store.status_changed',
  STORE_TEMPORARILY_CLOSED: 'identity.store.temporarily_closed',
  STORE_STAFF_CHANGED: 'identity.store.staff_changed',

  // Order & Communication
  ORDER_CREATED: 'order.order.created',
  ORDER_CONFIRMED: 'order.order.confirmed',
  ORDER_CANCELLED: 'order.order.cancelled',
  ORDER_STATUS_CHANGED: 'order.order.status_changed',
  CHAT_MESSAGE_SENT: 'order.chat.message.sent',

  // Fulfillment
  QR_GENERATED: 'fulfillment.qr.generated',
  DELIVERY_CONFIRMED: 'fulfillment.delivery.confirmed',
  QR_EXPIRED: 'fulfillment.qr.expired',
  QR_EXPIRING_SOON: 'fulfillment.qr.expiring_soon',
  DELIVERY_FAILED: 'fulfillment.delivery.failed',

  // Financial
  WALLET_TOPUP_APPROVED: 'financial.wallet.topup.approved',
  WALLET_TOPUP_FAILED: 'financial.wallet.topup.failed',
  PAYMENT_PROCESSED: 'financial.payment.processed',
  PAYMENT_FAILED: 'financial.payment.failed',
  PAYMENT_RELEASED: 'financial.payment.released',
  REFUND_ISSUED: 'financial.refund.issued',

  // Product Management
  LOW_STOCK_ALERT: 'product.inventory.low_stock',

  // Comando genérico de envío (cualquier microservicio)
  SEND_REQUESTED: 'notification.send.requested',
} as const;

/**
 * Patrones de binding de la cola propia al exchange compartido. Se enlaza a todos los
 * dominios que pueden originar una notificación más el canal de comandos directos.
 */
export const BINDING_PATTERNS = [
  'identity.#',
  'order.#',
  'fulfillment.#',
  'financial.#',
  'product.#',
  'notification.#',
];
