import { NotificationCatalog, isCatalogued } from './notification-catalog';
import { ConsumedEvents } from './event-patterns';
import { ChannelType } from '../notifications/notification.enums';

describe('NotificationCatalog', () => {
  it('mapea user.registered a una bienvenida por email + realtime al usuario', () => {
    const built = NotificationCatalog[ConsumedEvents.USER_REGISTERED]({
      userId: 'u1',
      email: 'ana@example.com',
      fullName: 'Ana',
    });
    expect(built).not.toBeNull();
    expect(built!.audience).toBe('user');
    expect(built!.userId).toBe('u1');
    expect(built!.channels).toEqual([ChannelType.EMAIL, ChannelType.REALTIME]);
    expect(built!.title).toContain('Bienvenido');
  });

  it('mapea order.confirmed a notificación independiente del QR', () => {
    const built = NotificationCatalog[ConsumedEvents.ORDER_CONFIRMED]({
      orderId: 'o1',
      buyerId: 'u2',
      storeId: 's1',
      pickupExpiresAt: '2026-07-10T12:00:00Z',
    });
    expect(built).not.toBeNull();
    expect(built!.audience).toBe('user');
    expect(built!.userId).toBe('u2');
    expect(built!.type).toBe('order.confirmed');
    expect(built!.dedupSeed).toBe('o1');
  });

  it('omite (null) order.status_changed: no notifica por cada cambio de estado', () => {
    const built = NotificationCatalog[ConsumedEvents.ORDER_STATUS_CHANGED]({
      orderId: 'o1',
      buyerId: 'u2',
      status: 'READY_FOR_PICKUP',
    });
    expect(built).toBeNull();
  });

  it('mapea fulfillment.qr.generated como mensaje de código de retiro listo', () => {
    const built = NotificationCatalog[ConsumedEvents.QR_GENERATED]({
      orderId: 'o1',
      buyerId: 'u2',
      imageUrl: 'https://blob/qr.png?sas',
      shortCode: 'A7K9-P2MX',
    });
    expect(built!.userId).toBe('u2');
    expect(built!.type).toBe('pickup.qr_ready');
    expect(built!.channels).toContain(ChannelType.WHATSAPP);
    expect(built!.imageUrl).toBe('https://blob/qr.png?sas');
    expect(built!.dedupSeed).toBe('o1');
  });

  it('mapea fulfillment.delivery.confirmed con la imagen del comprobante de entrega', () => {
    const built = NotificationCatalog[ConsumedEvents.DELIVERY_CONFIRMED]({
      orderId: 'o1',
      buyerId: 'u2',
      imageUrl: 'https://host/fulfillment/delivery/o1.png',
    });
    expect(built!.userId).toBe('u2');
    expect(built!.channels).toContain(ChannelType.WHATSAPP);
    expect(built!.imageUrl).toBe('https://host/fulfillment/delivery/o1.png');
  });

  it('dirige payment.released al dueño de la tienda (audience store)', () => {
    const built = NotificationCatalog[ConsumedEvents.PAYMENT_RELEASED]({
      orderId: 'o1',
      storeId: 's1',
      storePayoutAmount: 1500000,
    });
    expect(built!.audience).toBe('store');
    expect(built!.storeId).toBe('s1');
    expect(built!.body).toContain('$15.000');
  });

  it('omite (null) los eventos financieros sin userId del comprador', () => {
    const built = NotificationCatalog[ConsumedEvents.REFUND_ISSUED]({
      orderId: 'o1',
      refundedAmount: 1000,
    });
    expect(built).toBeNull();
  });

  it('mapea user.role_changed avisando al usuario por email, whatsapp y realtime', () => {
    const built = NotificationCatalog[ConsumedEvents.USER_ROLE_CHANGED]({
      userId: 'u3',
      roleId: 'r1',
      roleName: 'SELLER',
      action: 'assigned',
    });
    expect(built!.audience).toBe('user');
    expect(built!.userId).toBe('u3');
    expect(built!.channels).toEqual([
      ChannelType.EMAIL,
      ChannelType.WHATSAPP,
      ChannelType.REALTIME,
    ]);
    expect(built!.title).toContain('rol');
  });

  it('dirige store.status_changed al dueño de la tienda (audience store)', () => {
    const built = NotificationCatalog[ConsumedEvents.STORE_STATUS_CHANGED]({
      storeId: 's2',
      newStatus: 'TEMPORARILY_CLOSED',
      reason: 'Cierre temporal programado',
    });
    expect(built!.audience).toBe('store');
    expect(built!.storeId).toBe('s2');
    expect(built!.body).toContain('TEMPORARILY_CLOSED');
  });

  it('omite (null) staff_changed sin usuario afectado', () => {
    const built = NotificationCatalog[ConsumedEvents.STORE_STAFF_CHANGED]({
      storeId: 's3',
    } as never);
    expect(built).toBeNull();
  });

  it('isCatalogued reconoce solo las routing keys con notificación', () => {
    expect(isCatalogued(ConsumedEvents.USER_REGISTERED)).toBe(true);
    expect(isCatalogued('identity.store.updated')).toBe(false);
    expect(isCatalogued('algo.desconocido')).toBe(false);
  });
});
