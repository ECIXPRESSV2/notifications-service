import { registerAs } from '@nestjs/config';

/**
 * Credenciales y endpoints de los proveedores externos de cada canal de notificación.
 *
 * NINGUNA credencial se escribe en el código fuente: todas llegan por variables de
 * entorno. Cuando las credenciales de un canal están vacías, el proveedor entra en
 * modo "sandbox" y solo loguea el mensaje en consola en vez de enviarlo (mismo
 * principio que el PayoutService del financial-service). Así el servicio funciona de
 * extremo a extremo en desarrollo sin cuentas reales en Resend/Twilio/Meta/FCM.
 */
export const channelsConfig = registerAs('channels', () => ({
  email: {
    gmailClientId: process.env.GMAIL_CLIENT_ID,
    gmailClientSecret: process.env.GMAIL_CLIENT_SECRET,
    gmailRefreshToken: process.env.GMAIL_REFRESH_TOKEN,
    from: process.env.MAIL_FROM ?? `ECIExpress <${process.env.GMAIL_USER ?? 'no-reply@eciexpress.edu.co'}>`,
  },
  whatsapp: {
    // WhatsApp Cloud API de Meta (graph.facebook.com). Requiere una app verificada
    // en Meta Business con el número registrado como sender.
    apiUrl: process.env.WHATSAPP_API_URL ?? 'https://graph.facebook.com/v21.0',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    token: process.env.WHATSAPP_TOKEN,
  },
  sms: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    from: process.env.TWILIO_FROM,
  },
  fulfillmentPublicUrl: process.env.FULFILLMENT_PUBLIC_URL ?? '',
}));
