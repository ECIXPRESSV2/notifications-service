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

@Injectable()
export class EmailChannel implements NotificationChannel {
  readonly type = ChannelType.EMAIL;
  private readonly logger = new Logger(EmailChannel.name);

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
      const messageId = await sendViaGmailApi({
        clientId,
        clientSecret,
        refreshToken,
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

  private buildTemplateVars(message: ChannelMessage): Record<string, unknown> {
    const data = message.data ?? {};
    return {
      title: message.title,
      body: message.body,
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
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  from: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: EmailAttachment[];
}

export async function sendViaGmailApi(opts: GmailSendOptions): Promise<string> {
  const auth = new google.auth.OAuth2(opts.clientId, opts.clientSecret);
  auth.setCredentials({ refresh_token: opts.refreshToken });

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

/** Construye el mensaje RFC 822: simple si no hay adjuntos, multipart/mixed si los hay. */
function buildRawMessage(opts: GmailSendOptions): string {
  const contentType = opts.html ? 'text/html' : 'text/plain';
  const body = opts.html ?? opts.text ?? '';
  const attachments = opts.attachments ?? [];

  if (attachments.length === 0) {
    return [
      `From: ${opts.from}`,
      `To: ${opts.to}`,
      `Subject: ${opts.subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: ${contentType}; charset=UTF-8`,
      ``,
      body,
    ].join('\r\n');
  }

  const boundary = `eciexpress_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: ${contentType}; charset=UTF-8`,
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
