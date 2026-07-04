import { Repository } from 'typeorm';
import { NotificationPreference } from './entities/notification-preference.entity';
import { ChannelType } from '../notifications/notification.enums';
import { PreferencesService } from './preferences.service';

function build() {
  const prefs = {
    findOne: jest.fn(),
    create: jest.fn((x) => x),
    save: jest.fn((x) => Promise.resolve(x)),
  } as unknown as jest.Mocked<Repository<NotificationPreference>>;
  return { service: new PreferencesService(prefs), prefs };
}

describe('PreferencesService', () => {
  it('getOrCreate devuelve la fila existente', async () => {
    const { service, prefs } = build();
    prefs.findOne.mockResolvedValue({ userId: 'u1' } as NotificationPreference);
    const res = await service.getOrCreate('u1');
    expect(res.userId).toBe('u1');
    expect(prefs.save).not.toHaveBeenCalled();
  });

  it('getOrCreate crea la fila si no existe', async () => {
    const { service, prefs } = build();
    prefs.findOne.mockResolvedValue(null);
    await service.getOrCreate('u1');
    expect(prefs.create).toHaveBeenCalledWith({ userId: 'u1' });
    expect(prefs.save).toHaveBeenCalled();
  });

  it('update aplica el dto sobre la fila y guarda', async () => {
    const { service, prefs } = build();
    prefs.findOne.mockResolvedValue({ userId: 'u1', whatsappEnabled: true } as NotificationPreference);
    const res = await service.update('u1', { whatsappEnabled: false } as never);
    expect(res.whatsappEnabled).toBe(false);
  });

  it('isChannelEnabled = true cuando no hay preferencias (opt-out)', async () => {
    const { service, prefs } = build();
    prefs.findOne.mockResolvedValue(null);
    expect(await service.isChannelEnabled('u1', ChannelType.WHATSAPP)).toBe(true);
  });

  it('isChannelEnabled respeta el flag por canal', async () => {
    const { service, prefs } = build();
    prefs.findOne.mockResolvedValue({
      emailEnabled: true,
      whatsappEnabled: false,
      smsEnabled: true,
      realtimeEnabled: true,
    } as NotificationPreference);
    expect(await service.isChannelEnabled('u1', ChannelType.WHATSAPP)).toBe(false);
    expect(await service.isChannelEnabled('u1', ChannelType.EMAIL)).toBe(true);
  });
});
