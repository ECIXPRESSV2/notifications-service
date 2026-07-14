import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { formatCop } from '../common/format.util';
import {
  ChannelType,
  DeliveryStatus,
} from '../notifications/notification.enums';
import {
  ChannelMessage,
  ChannelResult,
  EmailAttachment,
  NotificationChannel,
} from './channel.interface';
import { TemplateService } from './template.service';

type GmailAuthClient = InstanceType<typeof google.auth.OAuth2>;

@Injectable()
export class EmailChannel implements NotificationChannel {
  readonly type = ChannelType.EMAIL;
  private readonly logger = new Logger(EmailChannel.name);

  // Cliente OAuth2 compartido entre TODOS los envíos (el canal es singleton en Nest). Antes
  // se creaba un google.auth.OAuth2 nuevo por cada send(), así que nunca reutilizaba el
  // access_token cacheado: cuando varios eventos de un mismo pedido disparaban correos casi
  // simultáneos, cada llamada intentaba canjear el refresh_token en paralelo y Gmail
  // respondía "invalid_grant" a algunas de esas canjes concurrentes. Reutilizar el cliente
  // (y esperar el mismo refresh en curso, ver authReady) hace que solo se canjee una vez.
  private authClient: GmailAuthClient | null = null;
  private authReady: Promise<void> | null = null;
  // Reutilizar el cliente NO alcanza: gmail.users.messages.send() dispara su propio refresh
  // interno si no ve un access_token cacheado todavía, y varias llamadas concurrentes sobre
  // el MISMO cliente (recién creado, sin token cacheado aún) seguían canjeando el
  // refresh_token en paralelo cada una por su lado. Este lock explícito garantiza que, por
  // proceso, solo haya UN refresh en vuelo: las llamadas concurrentes esperan la misma
  // promesa en vez de disparar cada una la suya.
  private refreshInFlight: Promise<void> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly templates: TemplateService,
  ) {}

  async send(message: ChannelMessage): Promise<ChannelResult> {
    const clientId = this.config.get<string>('channels.email.gmailClientId');
    const clientSecret = this.config.get<string>('channels.email.gmailClientSecret');
    const refreshToken = this.config.get<string>('channels.email.gmailRefreshToken');
    const from = this.config.get<string>('channels.email.from')!;

    if (!message.destination) {
      return { status: DeliveryStatus.SKIPPED, provider: 'gmail-api', error: 'no_destination' };
    }

    const html = message.sourceEvent
      ? this.templates.render(message.sourceEvent, this.buildTemplateVars(message))
      : null;

    const attachments = message.attachments ?? [];

    if (!clientId || !clientSecret || !refreshToken) {
      this.logger.log(
        `[SANDBOX EMAIL] a=${message.destination} asunto="${message.title}" template=${message.sourceEvent ?? 'none'} adjuntos=${attachments.length}`,
      );
      return { status: DeliveryStatus.SENT, provider: 'sandbox' };
    }

    try {
      const auth = await this.getAuthClient(clientId, clientSecret, refreshToken);
      await this.ensureAccessToken(auth);
      const messageId = await sendViaGmailApi(auth, {
        from,
        to: message.destination,
        subject: message.title,
        html: html ?? undefined,
        text: !html ? message.body : undefined,
        attachments,
      });
      return { status: DeliveryStatus.SENT, provider: 'gmail-api', providerMessageId: messageId };
    } catch (error) {
      return { status: DeliveryStatus.FAILED, provider: 'gmail-api', error: (error as Error).message };
    }
  }

  /** Crea el cliente OAuth2 una sola vez y lo reutiliza; si dos send() concurrentes lo
   *  necesitan antes de que exista, ambos esperan la MISMA promesa de creación en vez de
   *  canjear el refresh_token cada uno por su lado. */
  private async getAuthClient(
    clientId: string,
    clientSecret: string,
    refreshToken: string,
  ): Promise<GmailAuthClient> {
    if (this.authClient) return this.authClient;
    if (!this.authReady) {
      this.authReady = (async () => {
        const client = new google.auth.OAuth2(clientId, clientSecret);
        client.setCredentials({ refresh_token: refreshToken });
        this.authClient = client;
      })();
    }
    await this.authReady;
    return this.authClient!;
  }

  /**
   * Garantiza un access_token vigente ANTES de llamar a la API de Gmail. Reutilizar el
   * cliente (getAuthClient) no bastaba: gmail.users.messages.send() dispara su propio
   * refresh interno si no encuentra un access_token cacheado, y varias llamadas
   * concurrentes sobre el mismo cliente recién creado (sin token todavía) igual canjeaban
   * el refresh_token cada una por su lado. Aquí se fuerza el refresh explícitamente y las
   * llamadas concurrentes esperan la MISMA promesa en vez de disparar cada una la suya.
   */
  private async ensureAccessToken(auth: GmailAuthClient): Promise<void> {
    const creds = auth.credentials;
    const stillValid =
      !!creds.access_token && !!creds.expiry_date && creds.expiry_date > Date.now() + 60_000;
    if (stillValid) return;

    if (!this.refreshInFlight) {
      this.refreshInFlight = auth
        .getAccessToken()
        .then(() => undefined)
        .finally(() => { this.refreshInFlight = null; });
    }
    await this.refreshInFlight;
  }

  private buildTemplateVars(message: ChannelMessage): Record<string, unknown> {
    const data = message.data ?? {};
    return {
      title: TemplateService.toAsciiHtml(message.title),
      body: TemplateService.toAsciiHtml(message.body),
      recipientName: message.recipientName ? ` ${message.recipientName}` : '',
      year: new Date().getFullYear(),
      frontendUrl: this.config.get<string>('app.frontendUrl') ?? '',
      ...data,
      ...(typeof data.amount === 'number'
        ? { amountFormatted: formatCop(data.amount) }
        : {}),
    };
  }
}

interface GmailSendOptions {
  from: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: EmailAttachment[];
}

export async function sendViaGmailApi(
  auth: GmailAuthClient,
  opts: GmailSendOptions,
): Promise<string> {
  const gmail = google.gmail({ version: 'v1', auth });

  const rawLines = buildRawMessage(opts);

  const encoded = Buffer.from(rawLines)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encoded },
  });

  return res.data.id ?? '';
}

/** Codifica el Subject con RFC 2047 (=?UTF-8?B?...) para caracteres no-ASCII. */
function encodeSubject(subject: string): string {
  if (/^[\x00-\x7F]*$/.test(subject)) return subject;
  const encoded = Buffer.from(subject, 'utf-8').toString('base64');
  return `=?UTF-8?B?${encoded}?=`;
}

/** Construye el mensaje RFC 822: simple si no hay adjuntos, multipart/mixed si los hay. */
function buildRawMessage(opts: GmailSendOptions): string {
  const contentType = opts.html ? 'text/html' : 'text/plain';
  const body = opts.html ?? opts.text ?? '';
  const attachments = opts.attachments ?? [];
  const subject = encodeSubject(opts.subject);

  if (attachments.length === 0) {
    return [
      `From: ${opts.from}`,
      `To: ${opts.to}`,
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: ${contentType}; charset=UTF-8`,
      `Content-Transfer-Encoding: 8bit`,
      ``,
      body,
    ].join('\r\n');
  }

  const boundary = `eciexpress_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: ${contentType}; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    body,
  ];

  for (const att of attachments) {
    // El contenido ya viene en base64; se reparte en líneas de 76 chars (MIME).
    const wrapped = att.contentBase64.replace(/(.{76})/g, '$1\r\n');
    lines.push(
      ``,
      `--${boundary}`,
      `Content-Type: ${att.contentType}; name="${att.filename}"`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${att.filename}"`,
      ``,
      wrapped,
    );
  }

  lines.push(``, `--${boundary}--`);
  return lines.join('\r\n');
}
