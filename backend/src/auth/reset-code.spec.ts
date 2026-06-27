import { genResetCode, sha256 } from './reset-code';

describe('reset-code', () => {
  it('genResetCode: 8 символов только из безопасного алфавита', () => {
    for (let i = 0; i < 30; i++) {
      const code = genResetCode();
      expect(code).toHaveLength(8);
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    }
  });

  it('sha256: детерминирован, hex 64 символа, разный для разных входов', () => {
    expect(sha256('CODE1234')).toBe(sha256('CODE1234'));
    expect(sha256('CODE1234')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256('CODE1234')).not.toBe(sha256('CODE1235'));
  });
});
