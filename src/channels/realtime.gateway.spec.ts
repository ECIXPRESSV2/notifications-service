import { Socket } from 'socket.io';
import { RealtimeGateway } from './realtime.gateway';

function socket(query: Record<string, unknown> = {}, headers: Record<string, unknown> = {}): Socket {
  return {
    handshake: { query, headers },
    join: jest.fn(),
    disconnect: jest.fn(),
  } as unknown as Socket;
}

describe('RealtimeGateway', () => {
  it('handleConnection une al usuario a su sala', () => {
    const gateway = new RealtimeGateway();
    const client = socket({ userId: 'u1' });
    gateway.handleConnection(client);
    expect(client.join).toHaveBeenCalledWith('user:u1');
  });

  it('handleConnection toma el userId del header x-user-id', () => {
    const gateway = new RealtimeGateway();
    const client = socket({}, { 'x-user-id': 'u2' });
    gateway.handleConnection(client);
    expect(client.join).toHaveBeenCalledWith('user:u2');
  });

  it('handleConnection desconecta si no hay userId', () => {
    const gateway = new RealtimeGateway();
    const client = socket();
    gateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
  });

  it('emitToUser emite a la sala del usuario', () => {
    const gateway = new RealtimeGateway();
    const emit = jest.fn();
    (gateway as unknown as { server: unknown }).server = { to: jest.fn().mockReturnValue({ emit }) };
    const ok = gateway.emitToUser('u1', { title: 'T' });
    expect(ok).toBe(true);
    expect(emit).toHaveBeenCalledWith('notification', { title: 'T' });
  });

  it('emitToUser devuelve false si no hay servidor', () => {
    const gateway = new RealtimeGateway();
    expect(gateway.emitToUser('u1', {})).toBe(false);
  });

  it('isUserOnline refleja el tamaño de la sala', () => {
    const gateway = new RealtimeGateway();
    (gateway as unknown as { server: unknown }).server = {
      sockets: { adapter: { rooms: new Map([['user:u1', new Set(['s1'])]]) } },
    };
    expect(gateway.isUserOnline('u1')).toBe(true);
    expect(gateway.isUserOnline('u2')).toBe(false);
  });

  it('handleDisconnect no lanza', () => {
    const gateway = new RealtimeGateway();
    expect(() => gateway.handleDisconnect(socket({ userId: 'u1' }))).not.toThrow();
  });
});
