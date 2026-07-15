/**
 * Payloads de los eventos de Fulfillment que consume este servicio.
 * TODO: alinear con el contrato definitivo del event catalog de Fulfillment.
 */

/** routing key: `fulfillment.qr.generated` */
export interface QrGeneratedPayload {
  orderId: string;
  buyerId: string;
  orderNumber?: string;
  qrCode?: string; // contenido o URL del QR de entrega
  imageUrl?: string; // URL (SAS) del PNG del QR en el blob; se manda como imagen por WhatsApp
  shortCode?: string;
  expiresAt?: string;
}

/** routing key: `fulfillment.delivery.confirmed` */
export interface DeliveryConfirmedPayload {
  orderId: string;
  buyerId: string;
  orderNumber?: string;
  imageUrl?: string; // URL pública del comprobante de entrega; se manda como imagen por WhatsApp
}

/** routing key: `fulfillment.qr.expired` */
export interface QrExpiredPayload {
  orderId: string;
  buyerId: string;
  orderNumber?: string;
}

/** routing key: `fulfillment.qr.expiring_soon` */
export interface QrExpiringSoonPayload {
  orderId: string;
  buyerId: string;
  storeId?: string;
  expiresAt?: string;
}

/** routing key: `fulfillment.delivery.failed` */
export interface DeliveryFailedPayload {
  orderId: string;
  buyerId: string;
  orderNumber?: string;
  reason?: string;
}
