import { PreferencesService } from './preferences.service';
import { PreferencesController } from './preferences.controller';

function build() {
  const service = {
    getOrCreate: jest.fn().mockResolvedValue({ userId: 'u1' }),
    update: jest.fn().mockResolvedValue({ userId: 'u1', whatsappEnabled: false }),
  } as unknown as jest.Mocked<PreferencesService>;
  return { controller: new PreferencesController(service), service };
}

describe('PreferencesController', () => {
  it('get delega en getOrCreate', async () => {
    const { controller, service } = build();
    await controller.get('u1');
    expect(service.getOrCreate).toHaveBeenCalledWith('u1');
  });

  it('update delega en update con el dto', async () => {
    const { controller, service } = build();
    const dto = { whatsappEnabled: false } as never;
    await controller.update('u1', dto);
    expect(service.update).toHaveBeenCalledWith('u1', dto);
  });
});
