import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { WhatsappChannel } from './whatsapp.channel';
import { ChannelMessage } from './channel.interface';
import { DeliveryStatus } from '../notifications/notification.enums';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;
// isAxiosError lo usa el canal para clasificar errores.
(mockedAxios as unknown as { isAxiosError: unknown }).isAxiosError = ((e: unknown) =>
  Boolean((e as { isAxiosError?: boolean })?.isAxiosError)) as never;

function channel(creds: { token?: string; phoneNumberId?: string } = {}) {
  const config = {
    get: (key: string) => {
      if (key === 'channels.whatsapp.token') return creds.token;
      if (key === 'channels.whatsapp.phoneNumberId') return creds.phoneNumberId;
      if (key === 'channels.whatsapp.apiUrl') return 'https://graph.facebook.com/v21.0';
      return undefined;
    },
  } as unknown as ConfigService;
  return new WhatsappChannel(config);
}

const base: ChannelMessage = { title: 'T', body: 'Hola', destination: '+573001234567' };

describe('WhatsappChannel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('SKIPPED si no hay destino', async () => {
    const res = await channel({ token: 't', phoneNumberId: 'p' }).send({ ...base, destination: null });
    expect(res.status).toBe(DeliveryStatus.SKIPPED);
    expect(res.error).toBe('no_destination');
  });

  it('modo sandbox (SENT) cuando faltan credenciales, sin llamar a Meta', async () => {
    const res = await channel({}).send(base);
    expect(res.status).toBe(DeliveryStatus.SENT);
    expect(res.provider).toBe('sandbox');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('envía imagen con caption cuando hay imageUrl', async () => {
    mockedAxios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.1' }] } });
    const res = await channel({ token: 't', phoneNumberId: 'p' }).send({
      ...base,
      imageUrl: 'https://blob/qr.png?sas',
    });
    expect(res.status).toBe(DeliveryStatus.SENT);
    expect(res.providerMessageId).toBe('wamid.1');
    const [, body] = mockedAxios.post.mock.calls[0];
    expect(body).toEqual(
      expect.objectContaining({
        type: 'image',
        image: { link: 'https://blob/qr.png?sas', caption: 'Hola' },
        to: '573001234567',
      }),
    );
  });

  it('envía texto cuando no hay imagen ni template', async () => {
    mockedAxios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.2' }] } });
    const res = await channel({ token: 't', phoneNumberId: 'p' }).send(base);
    expect(res.status).toBe(DeliveryStatus.SENT);
    const [, body] = mockedAxios.post.mock.calls[0];
    expect(body).toEqual(expect.objectContaining({ type: 'text' }));
  });

  it('SKIPPED requires_template cuando Meta responde 131047 (fuera de ventana 24h)', async () => {
    mockedAxios.post.mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { code: 131047 } } },
    });
    const res = await channel({ token: 't', phoneNumberId: 'p' }).send(base);
    expect(res.status).toBe(DeliveryStatus.SKIPPED);
    expect(res.error).toContain('requires_template');
  });

  it('FAILED ante error de imagen (p. ej. Meta no pudo descargar la URL)', async () => {
    mockedAxios.post.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { error: { message: 'media download error' } } },
    });
    const res = await channel({ token: 't', phoneNumberId: 'p' }).send({
      ...base,
      imageUrl: 'http://localhost/qr.png',
    });
    expect(res.status).toBe(DeliveryStatus.FAILED);
  });
});
