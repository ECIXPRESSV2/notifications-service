import { NotificationCatalog } from './notification-catalog';
import { ConsumedEvents } from './event-patterns';
import { ChannelType } from '../notifications/notification.enums';

/** Cobertura amplia de los builders del catálogo (uno por routing key relevante). */
describe('NotificationCatalog · builders', () => {
  it('identity: profile_updated, deactivated (suspendido) y temporarily_closed', () => {
    expect(NotificationCatalog[ConsumedEvents.USER_PROFILE_UPDATED]({ userId: 'u1', changedFields: ['email'] })!.userId).toBe('u1');
    const deact = NotificationCatalog[ConsumedEvents.USER_DEACTIVATED]({ userId: 'u1', reason: 'SUSPENDED' })!;
    expect(deact.title).toMatch(/suspendida/i);
    const closed = NotificationCatalog[ConsumedEvents.STORE_TEMPORARILY_CLOSED]({ storeId: 's1', closureId: 'c1', startsAt: 'x', endsAt: 'y', reason: 'z' })!;
    expect(closed.audience).toBe('store');
  });

  it('identity: staff_changed devuelve null sin userId y notifica con userId', () => {
    expect(NotificationCatalog[ConsumedEvents.STORE_STAFF_CHANGED]({ storeId: 's1' })).toBeNull();
    const assigned = NotificationCatalog[ConsumedEvents.STORE_STAFF_CHANGED]({ storeId: 's1', userId: 'u1', action: 'assigned' })!;
    expect(assigned.userId).toBe('u1');
  });

  it('order: created, cancelled y chat.message', () => {
    // order.created ya no genera notificación: el aviso "pendiente de pago" se eliminó
    // (el usuario recibe "Pago exitoso" y luego la confirmación con el QR).
    expect(NotificationCatalog[ConsumedEvents.ORDER_CREATED]({ orderId: 'o1', buyerId: 'u1', totalAmount: 1500000 })).toBeNull();
    expect(NotificationCatalog[ConsumedEvents.ORDER_CANCELLED]({ orderId: 'o1', buyerId: 'u1' })!.type).toBe('order.cancelled');
    // chat.message ya no genera notificación: el aviso se ve como contador de no-leídos
    // en la burbuja de mensajes, no en la campana de notificaciones.
    expect(NotificationCatalog[ConsumedEvents.CHAT_MESSAGE_SENT]({ conversationId: 'c1', messageId: 'm1', recipientId: 'u1', preview: 'hola' })).toBeNull();
  });

  it('fulfillment: qr_expired y delivery_failed', () => {
    expect(NotificationCatalog[ConsumedEvents.QR_EXPIRED]({ orderId: 'o1', buyerId: 'u1' })!.type).toBe('delivery.qr_expired');
    const failed = NotificationCatalog[ConsumedEvents.DELIVERY_FAILED]({ orderId: 'o1', buyerId: 'u1', reason: 'nadie' })!;
    expect(failed.body).toContain('nadie');
  });

  it('fulfillment: qr_expiring_soon solo va por WhatsApp y SMS (sin correo ni tiempo real)', () => {
    const warning = NotificationCatalog[ConsumedEvents.QR_EXPIRING_SOON]({
      orderId: 'o1', buyerId: 'u1', storeId: 's1', expiresAt: '2026-07-14T12:00:00.000Z',
    })!;
    expect(warning.type).toBe('delivery.qr_expiring_soon');
    expect(warning.channels).toEqual([ChannelType.WHATSAPP, ChannelType.SMS]);
    expect(warning.body).toContain('5 minutos');
  });

  it('financial: topup approved (con comprobante adjunto) y failed', () => {
    const approved = NotificationCatalog[ConsumedEvents.WALLET_TOPUP_APPROVED]({
      userId: 'u1', topupId: 't1', amount: 5000000,
      receipt: { filename: 'r.pdf', contentType: 'application/pdf', contentBase64: 'AAA' },
    })!;
    expect(approved.attachments).toHaveLength(1);
    expect(approved.body).toContain('$50.000');
    expect(NotificationCatalog[ConsumedEvents.WALLET_TOPUP_APPROVED]({ amount: 1 })).toBeNull();
    expect(NotificationCatalog[ConsumedEvents.WALLET_TOPUP_FAILED]({ userId: 'u1', amount: 1000 })!.type).toBe('wallet.topup_failed');
  });

  it('financial: payment processed/failed y refund', () => {
    const processed = NotificationCatalog[ConsumedEvents.PAYMENT_PROCESSED]({ userId: 'u1', orderId: 'o1', totalCharged: 1000 })!;
    expect(processed.channels).toContain(ChannelType.EMAIL);
    expect(NotificationCatalog[ConsumedEvents.PAYMENT_FAILED]({ userId: 'u1', orderId: 'o1', reason: 'INSUFFICIENT_FUNDS' })!.body).toMatch(/saldo/i);
    expect(NotificationCatalog[ConsumedEvents.REFUND_ISSUED]({ userId: 'u1', orderId: 'o1', refundedAmount: 1000 })!.type).toBe('refund.issued');
    expect(NotificationCatalog[ConsumedEvents.REFUND_ISSUED]({ orderId: 'o1' })).toBeNull();
  });

  it('financial: payment released a la tienda', () => {
    const released = NotificationCatalog[ConsumedEvents.PAYMENT_RELEASED]({ orderId: 'o1', storeId: 's1', storePayoutAmount: 900000 })!;
    expect(released.audience).toBe('store');
    expect(released.storeId).toBe('s1');
  });

  it('product: low_stock calcula el disponible real', () => {
    const low = NotificationCatalog[ConsumedEvents.LOW_STOCK_ALERT]({ productId: 'p1', storeId: 's1', name: 'X', stock: 10, reservedStock: 7, minStock: 5 })!;
    expect(low.data).toEqual(expect.objectContaining({ available: 3 }));
  });
});
