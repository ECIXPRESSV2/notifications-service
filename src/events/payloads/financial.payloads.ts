/**
 * Payloads de los eventos de Financial que consume este servicio.
 *
 * IMPORTANTE: hoy varios eventos de Financial NO incluyen el id del usuario destinatario
 * (publican `walletId`/`storeId` pero no `buyerId`/`userId`). Para poder notificar al
 * comprador, este servicio espera un `userId`/`buyerId` en el payload. Cuando no llega,
 * la notificación se omite con un log (no se inventan destinatarios).
 * TODO: pedir a Financial que incluya `userId` (comprador) en topup.approved,
 * payment.processed, payment.failed y refund.issued.
 */

/**
 * Comprobante de pago que Financial genera y adjunta al evento. El PDF viaja en
 * base64 para adjuntarse al correo; NO se persiste en la notificación in-app.
 */
export interface ReceiptAttachmentPayload {
  filename: string;
  contentType: string;
  contentBase64: string;
}

/** routing key: `financial.wallet.topup.approved` */
export interface WalletTopupApprovedPayload {
  topupId?: string;
  userId?: string; // Financial ya lo incluye (dueño de la billetera recargada)
  amount: number; // centavos COP
  receipt?: ReceiptAttachmentPayload; // comprobante de la recarga (adjunto del correo)
}

/** routing key: `financial.wallet.topup.failed` */
export interface WalletTopupFailedPayload {
  topupId?: string;
  userId?: string; // dueño de la billetera; sin él la notificación se omite
  amount: number; // centavos COP
  paymentMethod?: string; // ej. DAVIPLATA, CARD
  reason?: string; // estado/razón del rechazo (ej. DECLINED)
}

/** routing key: `financial.payment.processed` */
export interface PaymentProcessedPayload {
  orderId: string;
  userId?: string; // TODO: Financial debe incluir el buyerId/userId
  storeId?: string;
  totalCharged?: number;
  receipt?: ReceiptAttachmentPayload; // comprobante del pago (adjunto del correo)
}

/** routing key: `financial.payment.failed` */
export interface PaymentFailedPayload {
  orderId: string;
  userId?: string; // TODO: Financial debe incluir el buyerId/userId
  storeId?: string;
  reason?: string;
}

/** routing key: `financial.payment.released` (desembolso liberado al negocio) */
export interface PaymentReleasedPayload {
  orderId: string;
  storeId: string; // el dueño de la tienda recibe el aviso
  storePayoutAmount?: number;
}

/** routing key: `financial.refund.issued` */
export interface RefundIssuedPayload {
  orderId: string;
  userId?: string; // TODO: Financial debe incluir el buyerId/userId
  refundedAmount?: number;
}
