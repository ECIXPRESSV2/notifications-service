import * as fs from 'fs';
import { TemplateService } from './template.service';

jest.mock('fs');
const mockedFs = fs as jest.Mocked<typeof fs>;

describe('TemplateService', () => {
  const service = new TemplateService();
  beforeEach(() => jest.clearAllMocks());

  it('renderiza la plantilla reemplazando las variables {{...}}', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('<p>Hola {{name}}, total {{total}}</p>' as never);
    const html = service.render('financial.wallet.topup.approved', { name: 'Ana', total: '$10' });
    expect(html).toBe('<p>Hola Ana, total $10</p>');
  });

  it('sustituye por cadena vacía las variables nulas', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue('x={{v}}' as never);
    expect(service.render('order.order.created', { v: null })).toBe('x=');
  });

  it('devuelve null si el routing key no tiene punto', () => {
    expect(service.render('sinpunto', {})).toBeNull();
  });

  it('devuelve null si el archivo no existe', () => {
    mockedFs.existsSync.mockReturnValue(false);
    expect(service.render('financial.payment.processed', {})).toBeNull();
  });

  it('devuelve null (sin lanzar) si la lectura falla', () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockImplementation(() => {
      throw new Error('EIO');
    });
    expect(service.render('order.order.created', {})).toBeNull();
  });
});
