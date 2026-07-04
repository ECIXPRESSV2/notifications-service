import { ConfigService } from '@nestjs/config';
import { EmailChannel } from './email.channel';
import { TemplateService } from './template.service';
import { ChannelMessage } from './channel.interface';
import { DeliveryStatus } from '../notifications/notification.enums';

function build(creds: Record<string, string | undefined> = {}) {
  const config = {
    get: (key: string) => creds[key] ?? (key === 'channels.email.from' ? 'ECIExpress <no-reply@x.com>' : undefined),
  } as unknown as ConfigService;
  const templates = { render: jest.fn().mockReturnValue(null) } as unknown as jest.Mocked<TemplateService>;
  return { channel: new EmailChannel(config, templates), templates };
}

const base: ChannelMessage = { title: 'Asunto', body: 'Cuerpo', destination: 'a@x.com' };

describe('EmailChannel', () => {
  it('SKIPPED sin destino', async () => {
    const { channel } = build();
    const res = await channel.send({ title: 'T', body: 'B', destination: null } as never);
    expect(res.status).toBe(DeliveryStatus.SKIPPED);
    expect(res.error).toBe('no_destination');
  });

  it('sandbox (SENT) cuando faltan credenciales de Gmail', async () => {
    const { channel } = build();
    const res = await channel.send(base);
    expect(res.status).toBe(DeliveryStatus.SENT);
    expect(res.provider).toBe('sandbox');
  });

  it('renderiza la plantilla cuando hay sourceEvent', async () => {
    const { channel, templates } = build();
    templates.render.mockReturnValue('<p>hola</p>');
    await channel.send({ ...base, sourceEvent: 'order.order.created', data: { amount: 1000 } });
    expect(templates.render).toHaveBeenCalledWith(
      'order.order.created',
      expect.objectContaining({ amountFormatted: '$10' }),
    );
  });
});
