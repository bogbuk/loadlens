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
  const env = process.env.FMCSA_WEBKEY;
  afterEach(() => {
    global.fetch = orig;
    if (env === undefined) delete process.env.FMCSA_WEBKEY; else process.env.FMCSA_WEBKEY = env;
  });
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
  it('qc без ключа → undefined, без запроса', async () => {
    delete process.env.FMCSA_WEBKEY;
    global.fetch = jest.fn() as any;
    expect(await new FmcsaClient().qc('384859')).toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('qc: первый carrier из content, номер без нулей', async () => {
    process.env.FMCSA_WEBKEY = 'k';
    reply(200, { content: [{ carrier: { brokerAuthorityStatus: 'A', allowedToOperate: 'Y' } }] });
    expect(await new FmcsaClient().qc('055000')).toEqual({ brokerAuthorityStatus: 'A', allowedToOperate: 'Y' });
    expect((global.fetch as jest.Mock).mock.calls[0][0])
      .toBe('https://mobile.fmcsa.dot.gov/qc/services/carriers/docket-number/55000?webKey=k');
  });
  it('qc: пустой content → null (не найден)', async () => {
    process.env.FMCSA_WEBKEY = 'k';
    reply(200, { content: [] });
    expect(await new FmcsaClient().qc('9999999')).toBeNull();
  });
});
