import { WakeupService } from './wakeup.service';
import { WakeupController } from './wakeup.controller';

describe('WakeupController', () => {
  it('responde 202 y dispara pingAndNotify en segundo plano', () => {
    const wakeupService = {
      pingAndNotify: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<WakeupService>;
    const controller = new WakeupController(wakeupService);

    const res = controller.wakeup();

    expect(wakeupService.pingAndNotify).toHaveBeenCalled();
    expect(res.message).toMatch(/Wakeup iniciado/i);
    expect(res.timestamp).toEqual(expect.any(String));
  });

  it('no propaga el error si pingAndNotify falla', () => {
    const wakeupService = {
      pingAndNotify: jest.fn().mockRejectedValue(new Error('boom')),
    } as unknown as jest.Mocked<WakeupService>;
    const controller = new WakeupController(wakeupService);
    expect(() => controller.wakeup()).not.toThrow();
  });
});
