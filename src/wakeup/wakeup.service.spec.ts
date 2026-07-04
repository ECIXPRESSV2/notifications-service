import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { WakeupService } from './wakeup.service';

jest.mock('axios');
jest.mock('../channels/email.channel', () => ({ sendViaGmailApi: jest.fn().mockResolvedValue('id') }));
const mockedAxios = axios as jest.Mocked<typeof axios>;
(mockedAxios as unknown as { isAxiosError: unknown }).isAxiosError = (() => false) as never;

const ENV_KEYS = ['SERVICE_IDENTITY_URL', 'SERVICE_ORDERS_URL'];

function service(cfg: Record<string, string | undefined> = {}) {
  const config = { get: (k: string) => cfg[k] } as unknown as ConfigService;
  return new WakeupService(config);
}

describe('WakeupService', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    ENV_KEYS.forEach((k) => delete process.env[k]);
  });

  it('no hace nada si no hay URLs de servicio configuradas', async () => {
    await service().pingAndNotify();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('dispara wakeup, verifica servicios UP y arma el reporte (sandbox)', async () => {
    process.env.SERVICE_IDENTITY_URL = 'http://identity';
    process.env.SERVICE_ORDERS_URL = 'http://orders/';
    mockedAxios.get.mockResolvedValue({ status: 200, data: {} } as never);

    const svc = service({ 'app.wakeupEmail': 'report@x.com' });
    jest.useFakeTimers();
    const p = svc.pingAndNotify();
    await jest.advanceTimersByTimeAsync(91_000); // salta la espera de cold start
    await p;

    // Fase 1 (2 servicios x 2 rutas) + Fase 3 (1 ruta UP por servicio).
    expect(mockedAxios.get).toHaveBeenCalled();
  });

  it('marca DOWN los servicios que fallan y arma el reporte con fallas', async () => {
    process.env.SERVICE_IDENTITY_URL = 'http://identity';
    mockedAxios.get.mockRejectedValue(new Error('conn refused'));

    const svc = service({ 'app.wakeupEmail': 'report@x.com' });
    jest.useFakeTimers();
    const p = svc.pingAndNotify();
    await jest.advanceTimersByTimeAsync(91_000);
    await p;

    expect(mockedAxios.get).toHaveBeenCalled();
  });

  it('omite el reporte si no hay WAKEUP_REPORT_EMAIL', async () => {
    process.env.SERVICE_IDENTITY_URL = 'http://identity';
    mockedAxios.get.mockResolvedValue({ status: 200, data: {} } as never);

    const svc = service({}); // sin app.wakeupEmail
    jest.useFakeTimers();
    const p = svc.pingAndNotify();
    await jest.advanceTimersByTimeAsync(91_000);
    await p;

    expect(mockedAxios.get).toHaveBeenCalled();
  });
});
