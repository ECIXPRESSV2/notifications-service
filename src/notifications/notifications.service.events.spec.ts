import { NotificationsService } from './notifications.service';
import { ChannelType, DeliveryStatus } from './notification.enums';

/** Complementa notifications.service.spec: eventos del bus, ruteo de imageUrl y bandeja in-app. */
function build() {
  const notifications: any = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((x) => x),
    save: jest.fn((x) => Promise.resolve({ id: 'n1', deliveries: [], ...x })),
    find: jest.fn().mockResolvedValue([{ id: 'n1' }]),
    createQueryBuilder: jest.fn(),
  };
  const deliveries: any = { create: jest.fn((x) => x), save: jest.fn((x) => Promise.resolve(x)) };
  const dispatcher: any = {
    send: jest.fn().mockResolvedValue({ status: DeliveryStatus.SENT, provider: 'test' }),
  };
  const recipients: any = {
    findRecipient: jest.fn().mockResolvedValue({ phone: '+57300', email: 'a@x.com', fullName: 'Ana' }),
    resolveStoreOwner: jest.fn().mockResolvedValue('owner-1'),
  };
  const preferences: any = { isChannelEnabled: jest.fn().mockResolvedValue(true) };
  const logger: any = { logEvent: jest.fn(), warnEvent: jest.fn() };
  const config: any = { get: jest.fn().mockReturnValue('') };
  const service = new NotificationsService(
    notifications, deliveries, dispatcher, recipients, preferences, logger, config,
  );
  return { service, notifications, dispatcher, recipients };
}

describe('NotificationsService · eventos y bandeja', () => {
  it('ignora routing keys sin entrada en el catálogo', async () => {
    const { service, dispatcher } = build();
    await service.handleDomainEvent('algo.desconocido', {});
    expect(dispatcher.send).not.toHaveBeenCalled();
  });

  it('mapea fulfillment.qr.generated y pasa la imagen del QR al canal WhatsApp', async () => {
    const { service, dispatcher } = build();
    await service.handleDomainEvent('fulfillment.qr.generated', {
      orderId: 'o1', buyerId: 'u1', imageUrl: 'https://blob/qr.png?sas', shortCode: 'A7K9',
    });
    const whatsapp = dispatcher.send.mock.calls.find((c: unknown[]) => c[0] === ChannelType.WHATSAPP);
    expect(whatsapp?.[1]).toEqual(expect.objectContaining({ imageUrl: 'https://blob/qr.png?sas' }));
  });

  it('no despacha cuando el builder devuelve null (order.status_changed)', async () => {
    const { service, dispatcher } = build();
    await service.handleDomainEvent('order.order.status_changed', {
      orderId: 'o1', buyerId: 'u1', status: 'READY_FOR_PICKUP',
    });
    expect(dispatcher.send).not.toHaveBeenCalled();
  });

  it('resuelve el dueño de la tienda para eventos con audience store', async () => {
    const { service, recipients, dispatcher } = build();
    await service.handleDomainEvent('product.inventory.low_stock', {
      productId: 'p1', storeId: 's1', name: 'X', stock: 1, reservedStock: 0, minStock: 5,
    });
    expect(recipients.resolveStoreOwner).toHaveBeenCalledWith('s1');
    expect(dispatcher.send).toHaveBeenCalled();
  });

  it('handleSendCommand despacha el comando genérico', async () => {
    const { service, dispatcher } = build();
    await service.handleSendCommand({
      recipientUserId: 'u1', channels: [ChannelType.WHATSAPP], title: 'T', body: 'B',
    } as never);
    expect(dispatcher.send).toHaveBeenCalled();
  });

  it('listForUser consulta las notificaciones del usuario', async () => {
    const { service, notifications } = build();
    const res = await service.listForUser('u1', { limit: 10, offset: 0 } as never);
    expect(notifications.find).toHaveBeenCalled();
    expect(res).toHaveLength(1);
  });

  it('markRead marca leída una notificación del usuario', async () => {
    const { service, notifications } = build();
    notifications.findOne.mockResolvedValue({ id: 'n1', recipientUserId: 'u1', readAt: null, deliveries: [] });
    await service.markRead('u1', 'n1');
    expect(notifications.save).toHaveBeenCalled();
  });

  it('markAllRead usa el query builder de update', async () => {
    const { service, notifications } = build();
    const qb: any = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 4 }),
    };
    notifications.createQueryBuilder.mockReturnValue(qb);
    const res = await service.markAllRead('u1');
    expect(res).toEqual({ updated: 4 });
  });
});
