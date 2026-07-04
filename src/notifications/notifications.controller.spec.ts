import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

function build() {
  const service = {
    listForUser: jest.fn().mockResolvedValue([]),
    unreadCount: jest.fn().mockResolvedValue(3),
    markRead: jest.fn(),
    markAllRead: jest.fn().mockResolvedValue({ updated: 5 }),
    dispatch: jest.fn(),
  } as unknown as jest.Mocked<NotificationsService>;
  return { controller: new NotificationsController(service), service };
}

describe('NotificationsController', () => {
  it('list delega en listForUser', async () => {
    const { controller, service } = build();
    await controller.list('u1', { limit: 10 } as never);
    expect(service.listForUser).toHaveBeenCalledWith('u1', { limit: 10 });
  });

  it('unreadCount devuelve el conteo', async () => {
    const { controller } = build();
    expect(await controller.unreadCount('u1')).toEqual({ count: 3 });
  });

  it('markRead delega con userId e id', async () => {
    const { controller, service } = build();
    service.markRead.mockResolvedValue({
      id: 'n1',
      deliveries: [],
      createdAt: new Date(),
    } as never);
    await controller.markRead('u1', 'n1');
    expect(service.markRead).toHaveBeenCalledWith('u1', 'n1');
  });

  it('markAllRead delega', async () => {
    const { controller } = build();
    expect(await controller.markAllRead('u1')).toEqual({ updated: 5 });
  });

  it('send arma el DispatchRequest desde el dto', async () => {
    const { controller, service } = build();
    service.dispatch.mockResolvedValue({ id: 'n1', deliveries: [], createdAt: new Date() } as never);
    await controller.send({
      recipientUserId: 'u1',
      channels: ['WHATSAPP'],
      title: 'T',
      body: 'B',
    } as never);
    expect(service.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserId: 'u1', title: 'T', sourceService: 'api' }),
    );
  });
});
