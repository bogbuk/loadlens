import { parseApiKeys, isValidApiKey } from './api-keys';

describe('api-keys', () => {
  afterEach(() => { delete process.env.API_KEYS; });

  it('парсит список через запятую, trim, отбрасывает пустые', () => {
    process.env.API_KEYS = ' k1 , k2,, k3 ,';
    expect([...parseApiKeys()].sort()).toEqual(['k1', 'k2', 'k3']);
  });

  it('незаданная переменная → пустой набор', () => {
    expect(parseApiKeys().size).toBe(0);
  });

  it('isValidApiKey: членство в наборе', () => {
    process.env.API_KEYS = 'abc,def';
    expect(isValidApiKey('abc')).toBe(true);
    expect(isValidApiKey('xyz')).toBe(false);
  });

  it('isValidApiKey: пусто/undefined → false', () => {
    process.env.API_KEYS = 'abc';
    expect(isValidApiKey(undefined)).toBe(false);
    expect(isValidApiKey('')).toBe(false);
  });

  it('пустой API_KEYS → любой ключ невалиден', () => {
    process.env.API_KEYS = '';
    expect(isValidApiKey('abc')).toBe(false);
  });
});
