import { Sequelize } from 'sequelize-typescript';
import { Load } from '../loads/load.model';
import { repostStats } from './repost';

// Реальный Postgres: cd backend && LL_TEST_DATABASE_URL=postgresql://loadlens:loadlens@localhost:5436/loadlens npx jest repost
const url = process.env.LL_TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('repostStats', () => {
  let sequelize: Sequelize;
  const DAY = 86_400_000;
  const base = { board: 'dat', originMarket: 'RS_TEST_O', destMarket: 'RS_TEST_D', equipment: 'V',
    groupKey: 'dat|RS_TEST_O>RS_TEST_D|V', rate: 2000, loadedMiles: 700, deadheadMiles: 0 };

  beforeAll(async () => {
    sequelize = new Sequelize(url!, { dialect: 'postgres', logging: false, models: [Load] });
    await sequelize.sync();
    await Load.destroy({ where: { originMarket: 'RS_TEST_O' } });
    const now = Date.now();
    await Load.bulkCreate([
      // сырой формат MC из парсера — счётчик должен его нормализовать
      { ...base, loadId: 'RS1', brokerMc: 'MC-555000', firstSeen: new Date(now - 0 * DAY) },
      { ...base, loadId: 'RS2', brokerMc: '555000', firstSeen: new Date(now - 1 * DAY) },
      { ...base, loadId: 'RS3', brokerMc: '555000', firstSeen: new Date(now - 1 * DAY) },
      { ...base, loadId: 'RS4', brokerMc: '555000', firstSeen: new Date(now - 3 * DAY) },
      { ...base, loadId: 'RS5', brokerMc: '555000', firstSeen: new Date(now - 20 * DAY) }, // вне окна
      { ...base, loadId: 'RS6', brokerMc: '999999', firstSeen: new Date(now) },            // чужой брокер
      { ...base, loadId: 'RS7', brokerMc: '555000', equipment: 'R', firstSeen: new Date(now) }, // другой прицеп
    ] as any[]);
  });
  afterAll(async () => {
    await Load.destroy({ where: { originMarket: 'RS_TEST_O' } });
    await sequelize.close();
  });

  it('считает разные load_id и дни в окне 14 дней, нормализуя MC', async () => {
    expect(await repostStats(sequelize as any, '555000', 'RS_TEST_O', 'RS_TEST_D', 'V'))
      .toEqual({ count: 4, days: 3, windowDays: 14 });
  });
  it('нет данных → нули', async () => {
    expect(await repostStats(sequelize as any, '123', 'RS_TEST_O', 'RS_TEST_D', 'V'))
      .toEqual({ count: 0, days: 0, windowDays: 14 });
  });
});
