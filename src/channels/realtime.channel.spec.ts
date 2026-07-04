import { RealtimeChannel } from './realtime.channel';
import { RealtimeGateway } from './realtime.gateway';
import { DeliveryStatus } from '../notifications/notification.enums';

function build() {
  const gateway = {
    isUserOnline: jest.fn(),
    emitToUser: jest.fn(),
  } as unknown as jest.Mocked<RealtimeGateway>;
  return { channel: new RealtimeChannel(gateway), gateway };
}

const msg = { userId: 'u1', title: 'T', body: 'B', type: 'order.confirmed' } as never;

describe('RealtimeChannel', () => {
  it('SKIPPED no_user_id cuando falta userId', async () => {
    const { channel } = build();
    const res = await channel.send({ title: 'T', body: 'B' } as never);
    expect(res.status).toBe(DeliveryStatus.SKIPPED);
    expect(res.error).toBe('no_user_id');
  });

  it('SKIPPED recipient_offline cuando el usuario no está conectado', async () => {
    const { channel, gateway } = build();
    gateway.isUserOnline.mockReturnValue(false);
    const res = await channel.send(msg);
    expect(res.status).toBe(DeliveryStatus.SKIPPED);
    expect(res.error).toBe('recipient_offline');
    expect(gateway.emitToUser).not.toHaveBeenCalled();
  });

  it('SENT y emite al usuario cuando está online', async () => {
    const { channel, gateway } = build();
    gateway.isUserOnline.mockReturnValue(true);
    const res = await channel.send(msg);
    expect(res.status).toBe(DeliveryStatus.SENT);
    expect(gateway.emitToUser).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ title: 'T', body: 'B', type: 'order.confirmed' }),
    );
  });
});
