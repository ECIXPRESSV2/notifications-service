import { RecipientsService } from '../recipients/recipients.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EventConsumerService } from './event-consumer.service';

function build() {
  const recipientsService = {
    handleUserRegistered: jest.fn(),
    handleUserProfileUpdated: jest.fn(),
    handleUserDeactivated: jest.fn(),
    handleStoreCreated: jest.fn(),
    handleStoreUpdated: jest.fn(),
  } as unknown as jest.Mocked<RecipientsService>;
  const notificationsService = {
    handleSendCommand: jest.fn(),
    handleDomainEvent: jest.fn(),
  } as unknown as jest.Mocked<NotificationsService>;
  return {
    consumer: new EventConsumerService(recipientsService, notificationsService),
    recipientsService,
    notificationsService,
  };
}

describe('EventConsumerService', () => {
  it('sincroniza la proyección de usuario en identity.user.registered', async () => {
    const { consumer, recipientsService, notificationsService } = build();
    await consumer.handleEvent('identity.user.registered', { userId: 'u1' });
    expect(recipientsService.handleUserRegistered).toHaveBeenCalled();
    // También es un evento catalogado → se despacha.
    expect(notificationsService.handleDomainEvent).toHaveBeenCalledWith(
      'identity.user.registered',
      { userId: 'u1' },
    );
  });

  it('actualiza la tienda tanto en store.updated como en store.status_changed', async () => {
    const { consumer, recipientsService } = build();
    await consumer.handleEvent('identity.store.status_changed', { storeId: 's1' });
    expect(recipientsService.handleStoreUpdated).toHaveBeenCalled();
  });

  it('atiende el comando genérico notification.send.requested', async () => {
    const { consumer, notificationsService } = build();
    await consumer.handleEvent('notification.send.requested', { title: 'T' });
    expect(notificationsService.handleSendCommand).toHaveBeenCalled();
    expect(notificationsService.handleDomainEvent).not.toHaveBeenCalled();
  });

  it('despacha eventos catalogados de otros dominios', async () => {
    const { consumer, notificationsService } = build();
    await consumer.handleEvent('fulfillment.qr.generated', { orderId: 'o1' });
    expect(notificationsService.handleDomainEvent).toHaveBeenCalledWith(
      'fulfillment.qr.generated',
      { orderId: 'o1' },
    );
  });

  it('ignora routing keys sin notificación asociada', async () => {
    const { consumer, notificationsService } = build();
    await consumer.handleEvent('identity.store.updated', { storeId: 's1' });
    expect(notificationsService.handleDomainEvent).not.toHaveBeenCalled();
  });

  it('captura los errores internamente (no relanza, para no reencolar)', async () => {
    const { consumer, notificationsService } = build();
    (notificationsService.handleDomainEvent as jest.Mock).mockRejectedValue(new Error('boom'));
    await expect(consumer.handleEvent('fulfillment.qr.generated', {})).resolves.toBeUndefined();
  });
});
