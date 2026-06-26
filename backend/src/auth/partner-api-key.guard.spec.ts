import { ForbiddenException } from '@nestjs/common';
import { PartnerApiKeyGuard } from './partner-api-key.guard';

function ctxWithKey(key?: string) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: key === undefined ? {} : { 'x-api-key': key } }) }),
  } as any;
}

describe('PartnerApiKeyGuard', () => {
  const OLD = process.env.PARTNER_API_KEY;
  afterEach(() => { process.env.PARTNER_API_KEY = OLD; });

  it('throws when env key is not set', () => {
    delete process.env.PARTNER_API_KEY;
    expect(() => new PartnerApiKeyGuard().canActivate(ctxWithKey('anything'))).toThrow(ForbiddenException);
  });
  it('throws on wrong key', () => {
    process.env.PARTNER_API_KEY = 'secret';
    expect(() => new PartnerApiKeyGuard().canActivate(ctxWithKey('wrong'))).toThrow(ForbiddenException);
  });
  it('passes on correct key', () => {
    process.env.PARTNER_API_KEY = 'secret';
    expect(new PartnerApiKeyGuard().canActivate(ctxWithKey('secret'))).toBe(true);
  });
});
