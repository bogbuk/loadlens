import { docketOf, FmcsaClient } from './fmcsa.client';

describe('docketOf', () => {
  it('дополняет нулями до 6 цифр, срезая лишние ведущие нули', () => {
    expect(docketOf('55000')).toBe('MC055000');
    expect(docketOf('055000')).toBe('MC055000');
    expect(docketOf('384859')).toBe('MC384859');
    expect(docketOf('1819236')).toBe('MC1819236');
  });
});

describe('FmcsaClient', () => {
  const orig = global.fetch;
  afterEach(() => { global.fetch = orig; });
  const reply = (status: number, body: unknown) =>
    (global.fetch = jest.fn().mockResolvedValue({ ok: status < 300, status, json: async () => body }) as any);

  it('authHist ходит в SODA 9mw4-x3tu по docket', async () => {
    reply(200, [{ mod_col_1: 'BROKER' }]);
    const rows = await new FmcsaClient().authHist('384859');
    expect(rows).toEqual([{ mod_col_1: 'BROKER' }]);
    expect((global.fetch as jest.Mock).mock.calls[0][0])
      .toBe('https://data.transportation.gov/resource/9mw4-x3tu.json?docket_number=MC384859&$limit=200');
  });
  it('motus ходит в SODA yu5v-wbh6', async () => {
    reply(200, []);
    await new FmcsaClient().motus('55000');
    expect((global.fetch as jest.Mock).mock.calls[0][0])
      .toBe('https://data.transportation.gov/resource/yu5v-wbh6.json?docket_number=MC055000&$limit=200');
  });
  it('5xx → reject', async () => {
    reply(503, {});
    await expect(new FmcsaClient().motus('1')).rejects.toThrow('503');
  });
  it('registry: текущие статусы из реестра L&I 6eyk-hxee (без ключа)', async () => {
    reply(200, [{ docket_number: 'MC384859', broker_stat: 'A', common_stat: 'I', contract_stat: 'I' }]);
    expect(await new FmcsaClient().registry('384859'))
      .toEqual({ brokerAuthorityStatus: 'A', commonAuthorityStatus: 'I', contractAuthorityStatus: 'I' });
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      'https://data.transportation.gov/resource/6eyk-hxee.json?docket_number=MC384859&$select=broker_stat,common_stat,contract_stat&$limit=1');
  });
  it('registry: нет строки → null (не найден в реестре)', async () => {
    reply(200, []);
    expect(await new FmcsaClient().registry('9999999')).toBeNull();
  });
  it('registry: 5xx → reject', async () => {
    reply(502, {});
    await expect(new FmcsaClient().registry('1')).rejects.toThrow('502');
  });
});
