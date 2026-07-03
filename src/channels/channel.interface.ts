import {
  ChannelType,
  DeliveryStatus,
} from '../notifications/notification.enums';

/**
 * Adjunto de correo. `contentBase64` es el contenido del archivo codificado en base64.
 * Lo produce quien origina el evento (p. ej. financial adjunta el comprobante de pago)
 * y viaja fuera de `data` para no persistirse en la notificación in-app.
 */
export interface EmailAttachment {
  filename: string;
  contentType: string;
  contentBase64: string;
}

/**
 * Mensaje ya renderizado que se entrega a un canal para su envío. El dispatcher
 * resuelve el destino concreto (email/teléfono/tokens) antes de invocar el canal.
 */
export interface ChannelMessage {
  /** Adjuntos del correo (solo los usa el canal EMAIL). */
  attachments?: EmailAttachment[] | null;
  /** Destino directo para EMAIL/SMS/WHATSAPP (correo o teléfono E.164). */
  destination?: string | null;
  /** Id de usuario para emitir por el canal REALTIME (sala = userId). */
  userId?: string | null;
  /** Routing key del evento origen — resuelve la plantilla en templates/{service}/{event}.html */
  sourceEvent?: string | null;
  /** Tipo de notificación (del catálogo) — el front lo usa para elegir el estilo del toast. */
  type?: string | null;
  /** Nombre del destinatario — disponible como {{recipientName}} en plantillas. */
  recipientName?: string | null;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
  /**
   * URL pública de una imagen a adjuntar (WhatsApp la descarga directamente).
   * TODO(blob-storage): cuando las imágenes se suban a Azure Blob Storage, pasar aquí
   * la URL del blob público. Pendiente definir: nombre del contenedor y connection string.
   * Alternativa si el contenedor es privado: generar una SAS URL con expiración corta.
   */
  imageUrl?: string | null;
}

/** Resultado del envío por un canal. */
export interface ChannelResult {
  status: DeliveryStatus;
  provider: string;
  providerMessageId?: string;
  error?: string;
}

/**
 * Contrato común de todos los canales de notificación. Cada proveedor concreto
 * (Resend, Twilio, WhatsApp Cloud API, FCM, Socket.IO) lo implementa. Permite que el
 * dispatcher trate todos los canales de forma uniforme y que se agreguen canales
 * nuevos en el futuro sin tocar la orquestación.
 */
export interface NotificationChannel {
  readonly type: ChannelType;
  send(message: ChannelMessage): Promise<ChannelResult>;
}
