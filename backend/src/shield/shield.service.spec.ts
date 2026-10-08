import { BadRequestException } from '@nestjs/common';
import { ShieldService } from './shield.service';

const NOW = new Date('2026-10-07T12:00:00Z');
const HOUR = 3_600_000;

function setup(over: Partial<Record<'qc' | 'authHist' | 'motus', jest.Mock>> = {}, cached: any = null) {
  const store = new Map<string, any>(cached ? [[cached.mc, cached]] : []);
  const model = {
    findByPk: jest.fn(async (mc: string) => store.get(mc) ?? null),
    upsert: jest.fn(async (row: any) => { store.set(row.mc, row); }),
  };
  const fmcsa = {
    qc: over.qc ?? jest.fn().mockResolvedValue({ brokerAuthorityStatus: 'A', allowedToOperate: 'Y' }),
    authHist: over.authHist ?? jest.fn().mockResolvedValue([{ mod_col_1: 'PROPERTY BROKER', original_action_desc: 'GRANTED', orig_served_date: '07/12/2000' }]),
    motus: over.motus ?? jest.fn().mockResolvedValue([]),
  };
  const sequelize = { query: jest.fn().mockResolvedValue([{ count: 6, days: 4 }]) };
  return { svc: new ShieldService(model as any, fmcsa as any, sequelize as any), model, fmcsa, sequelize };
}

describe('ShieldService', () => {
  it('собирает статус + историю и кэширует полный результат', async () => {
    const { svc, model } = setup();
    const a = await svc.authority('384859', NOW);
    expect(a).toMatchObject({ status: 'active', allowedToOperate: true, grantedAt: '2000-07-12', incidents12m: 0 });
    expect(model.upsert).toHaveBeenCalledTimes(1);
  });
  it('без ключа status=null, история есть, кэшируется', async () => {
    const { svc, model } = setup({ qc: jest.fn().mockResolvedValue(undefined) });
    const a = await svc.authority('384859', NOW);
    expect(a).toMatchObject({ status: null, allowedToOperate: null, grantedAt: '2000-07-12' });
    expect(model.upsert).toHaveBeenCalled();
  });
  it('docket не найден → not_found', async () => {
    const { svc } = setup({ qc: jest.fn().mockResolvedValue(null), authHist: jest.fn().mockResolvedValue([]) });
    expect((await svc.authority('9999999', NOW))!.status).toBe('not_found');
  });
  it('свежий кэш — без сетевых запросов', async () => {
    const cached = { mc: '1', data: { status: 'active' }, fetchedAt: new Date(NOW.getTime() - 2 * HOUR) };
    const { svc, fmcsa } = setup({}, cached);
    expect(await svc.authority('1', NOW)).toEqual({ status: 'active' });
    expect(fmcsa.authHist).not.toHaveBeenCalled();
  });
  it('not_found живёт в кэше 6ч, а не 24ч', async () => {
    const cached = { mc: '1', data: { status: 'not_found' }, fetchedAt: new Date(NOW.getTime() - 7 * HOUR) };
    const { svc, fmcsa } = setup({}, cached);
    await svc.authority('1', NOW);
    expect(fmcsa.authHist).toHaveBeenCalled();
  });
  it('все источники упали → протухший кэш', async () => {
    const boom = jest.fn().mockRejectedValue(new Error('FMCSA HTTP 503'));
    const cached = { mc: '1', data: { status: 'active', grantedAt: '2000-07-12' }, fetchedAt: new Date(NOW.getTime() - 48 * HOUR) };
    const { svc } = setup({ qc: boom, authHist: boom, motus: boom }, cached);
    expect(await svc.authority('1', NOW)).toEqual({ status: 'active', grantedAt: '2000-07-12' });
  });
  it('все источники упали и кэша нет → null', async () => {
    const boom = jest.fn().mockRejectedValue(new Error('timeout'));
    const { svc } = setup({ qc: boom, authHist: boom, motus: boom });
    expect(await svc.authority('1', NOW)).toBeNull();
  });
  it('частичный сбой (QCMobile упал) — кэшируется на 30 мин, а не на сутки', async () => {
    const qc = jest.fn().mockRejectedValue(new Error('FMCSA HTTP 401'));
    const { svc, fmcsa } = setup({ qc });
    const a = await svc.authority('384859', NOW);
    expect(a).toMatchObject({ status: null, grantedAt: '2000-07-12' });
    await svc.authority('384859', new Date(NOW.getTime() + 20 * 60_000));
    expect(fmcsa.authHist).toHaveBeenCalledTimes(1);   // постоянный сбой ключа не даёт веер запросов
    await svc.authority('384859', new Date(NOW.getTime() + 31 * 60_000));
    expect(fmcsa.authHist).toHaveBeenCalledTimes(2);
  });
  it('бюджет внешних запросов исчерпан → без похода в FMCSA: протухший кэш или null', async () => {
    const cached = { mc: '7', data: { status: 'active' }, fetchedAt: new Date(NOW.getTime() - 48 * HOUR) };
    const { svc, fmcsa } = setup({}, cached);
    (svc as any).fetchLimit = 2;
    await svc.authority('1', NOW);
    await svc.authority('2', NOW);
    expect(await svc.authority('3', NOW)).toBeNull();
    expect(await svc.authority('7', NOW)).toEqual({ status: 'active' });
    expect(fmcsa.authHist).toHaveBeenCalledTimes(2);
    expect(await svc.authority('4', new Date(NOW.getTime() + 61_000))).not.toBeNull(); // окно сдвинулось
  });
  it('параллельные запросы одного MC дедупятся', async () => {
    const { svc, fmcsa } = setup();
    await Promise.all([svc.authority('384859', NOW), svc.authority('384859', NOW)]);
    expect(fmcsa.authHist).toHaveBeenCalledTimes(1);
  });
  it('shield: нормализует MC, считает repost только при полном lane', async () => {
    const { svc, sequelize } = setup();
    const full = await svc.shield('MC-384859', 'A_TX', 'B_GA', 'V', NOW);
    expect(full.mc).toBe('384859');
    expect(full.repost).toEqual({ count: 6, days: 4, windowDays: 14 });
    const partial = await svc.shield('384859', 'A_TX', undefined, 'V', NOW);
    expect(partial.repost).toBeNull();
    expect(sequelize.query).toHaveBeenCalledTimes(1);
  });
  it('shield: нецифровой MC → 400', async () => {
    const { svc } = setup();
    await expect(svc.shield('abc')).rejects.toBeInstanceOf(BadRequestException);
  });
});
