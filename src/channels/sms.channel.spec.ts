import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { SmsChannel } from './sms.channel';
import { DeliveryStatus } from '../notifications/notification.enums';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;
(mockedAxios as unknown as { isAxiosError: unknown }).isAxiosError = (() => false) as never;

function channel(creds: Record<string, string | undefined> = {}) {
  const config = {
    get: (key: string) => creds[key],
  } as unknown as ConfigService;
  return new SmsChannel(config);
}

const base = { title: 'T', body: 'Hola', destination: '+573001234567' } as never;

describe('SmsChannel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('SKIPPED sin destino', async () => {
    const res = await channel().send({ title: 'T', body: 'B', destination: null } as never);
    expect(res.status).toBe(DeliveryStatus.SKIPPED);
  });

  it('sandbox (SENT) sin credenciales', async () => {
    const res = await channel().send(base);
    expect(res.status).toBe(DeliveryStatus.SENT);
    expect(res.provider).toBe('sandbox');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('envía por Twilio cuando hay credenciales', async () => {
    mockedAxios.post.mockResolvedValue({ data: { sid: 'SM1' } });
    const res = await channel({
      'channels.sms.accountSid': 'AC1',
      'channels.sms.authToken': 'tok',
      'channels.sms.from': '+1',
    }).send(base);
    expect(res.status).toBe(DeliveryStatus.SENT);
    expect(res.providerMessageId).toBe('SM1');
  });

  it('FAILED ante error de Twilio', async () => {
    mockedAxios.post.mockRejectedValue(new Error('boom'));
    const res = await channel({
      'channels.sms.accountSid': 'AC1',
      'channels.sms.authToken': 'tok',
      'channels.sms.from': '+1',
    }).send(base);
    expect(res.status).toBe(DeliveryStatus.FAILED);
  });
});
