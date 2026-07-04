import { Repository } from 'typeorm';
import { Recipient } from './entities/recipient.entity';
import { NotificationStore } from './entities/notification-store.entity';
import { NotificationLogger } from '../common/logger/notification.logger';
import { RecipientsService } from './recipients.service';

function build() {
  const recipients = {
    save: jest.fn((x) => Promise.resolve(x)),
    create: jest.fn((x) => x),
    findOne: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<Repository<Recipient>>;
  const stores = {
    save: jest.fn((x) => Promise.resolve(x)),
    create: jest.fn((x) => x),
    findOne: jest.fn(),
  } as unknown as jest.Mocked<Repository<NotificationStore>>;
  const logger = { logEvent: jest.fn() } as unknown as NotificationLogger;
  return { service: new RecipientsService(recipients, stores, logger), recipients, stores };
}

describe('RecipientsService', () => {
  it('handleUserRegistered normaliza el teléfono colombiano a E.164', async () => {
    const { service, recipients } = build();
    await service.handleUserRegistered({ userId: 'u1', email: 'a@x.com', phone: '3001234567' } as never);
    expect(recipients.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1', phone: '+573001234567', isActive: true }),
    );
  });

  it('handleUserRegistered ignora payloads sin userId', async () => {
    const { service, recipients } = build();
    await service.handleUserRegistered({} as never);
    expect(recipients.save).not.toHaveBeenCalled();
  });

  it('handleUserProfileUpdated aplica solo los campos presentes en newValues', async () => {
    const { service, recipients } = build();
    recipients.findOne.mockResolvedValue({ id: 'u1', email: 'old@x.com', fullName: 'Old' } as Recipient);
    await service.handleUserProfileUpdated({ userId: 'u1', newValues: { email: 'new@x.com' } } as never);
    expect(recipients.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1', email: 'new@x.com', fullName: 'Old' }),
    );
  });

  it('handleUserDeactivated marca el destinatario inactivo', async () => {
    const { service, recipients } = build();
    await service.handleUserDeactivated({ userId: 'u1' } as never);
    expect(recipients.update).toHaveBeenCalledWith({ id: 'u1' }, { isActive: false });
  });

  it('handleStoreCreated guarda la proyección de tienda con su dueño', async () => {
    const { service, stores } = build();
    await service.handleStoreCreated({ storeId: 's1', name: 'Tienda', ownerId: 'o1' } as never);
    expect(stores.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1', name: 'Tienda', ownerUserId: 'o1' }),
    );
  });

  it('handleStoreUpdated crea la tienda si no existía', async () => {
    const { service, stores } = build();
    stores.findOne.mockResolvedValue(null);
    await service.handleStoreUpdated({ storeId: 's1', name: 'Nueva', status: 'CLOSED' } as never);
    expect(stores.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1', name: 'Nueva', isActive: false }),
    );
  });

  it('resolveStoreOwner devuelve el dueño o null', async () => {
    const { service, stores } = build();
    stores.findOne.mockResolvedValueOnce({ ownerUserId: 'o1' } as NotificationStore);
    expect(await service.resolveStoreOwner('s1')).toBe('o1');
    stores.findOne.mockResolvedValueOnce(null);
    expect(await service.resolveStoreOwner('s2')).toBeNull();
  });

  it('findRecipient consulta por id', async () => {
    const { service, recipients } = build();
    recipients.findOne.mockResolvedValue({ id: 'u1' } as Recipient);
    expect(await service.findRecipient('u1')).toEqual({ id: 'u1' });
  });
});
