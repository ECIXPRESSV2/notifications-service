/**
 * Payloads de los eventos de Order & Communication que consume este servicio.
 *
 * El contrato definitivo de Order aún no está fijado; aquí se declaran los campos
 * mínimos necesarios para notificar. Se asume que los eventos de orden incluyen el
 * `buyerId` para poder dirigir la notificación al comprador.
 * TODO: alinear con el contrato definitivo del event catalog de Order.
 */

/** routing key: `order.order.created` */
export interface OrderCreatedPayload {
  orderId: string;
  buyerId: string;
  storeId?: string;
  totalAmount?: number; // centavos COP
}

/** routing key: `order.order.confirmed` (orden pagada y lista para despacho) */
export interface OrderConfirmedPayload {
  orderId: string;
  orderNumber?: string;
  buyerId: string;
  storeId: string;
  pickupExpiresAt?: string;
}

/** routing key: `order.order.cancelled` */
export interface OrderCancelledPayload {
  orderId: string;
  orderNumber?: string;
  buyerId: string;
}

/** routing key: `order.order.status_changed` */
export interface OrderStatusChangedPayload {
  orderId: string;
  buyerId: string;
  status: string;
}

/** routing key: `order.chat.message.sent` */
export interface ChatMessageSentPayload {
  messageId?: string;
  conversationId?: string;
  senderId?: string;
  recipientId: string; // a quién se le avisa del mensaje
  preview?: string;
}
