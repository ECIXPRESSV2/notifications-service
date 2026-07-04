import { formatCop, maskDestination } from './format.util';

describe('formatCop', () => {
  it('convierte centavos a pesos con separador de miles colombiano', () => {
    expect(formatCop(1234500)).toBe('$12.345');
    expect(formatCop(100)).toBe('$1');
    expect(formatCop(0)).toBe('$0');
  });

  it('devuelve $0 para null/undefined/NaN', () => {
    expect(formatCop(null)).toBe('$0');
    expect(formatCop(undefined)).toBe('$0');
    expect(formatCop(NaN)).toBe('$0');
  });
});

describe('maskDestination', () => {
  it('devuelve null si no hay destino', () => {
    expect(maskDestination(null)).toBeNull();
    expect(maskDestination(undefined)).toBeNull();
  });

  it('enmascara emails dejando visibles las 2 primeras letras y el dominio', () => {
    expect(maskDestination('anamaria@example.com')).toBe('an******@example.com');
  });

  it('enmascara teléfonos dejando los últimos 4 dígitos', () => {
    expect(maskDestination('+573001234567')).toBe('*********4567');
  });

  it('enmascara por completo destinos de 4 o menos caracteres', () => {
    expect(maskDestination('1234')).toBe('****');
  });
});
