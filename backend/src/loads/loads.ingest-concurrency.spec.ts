import { Sequelize } from 'sequelize-typescript';
import { Load } from './load.model';
import { LoadsService } from './loads.service';

// Интеграционный тест на реальном Postgres: два клиента (локальное + облачное расширение) шлют ОДНУ выдачу
// одновременно, в разном порядке строк. До фикса 2026-09-14 это давало `deadlock detected` между
// INSERT … ON CONFLICT одного запроса и UPDATE seen_count другого (pg-лог прода 13.09 17:55 UTC).
// Гоняется только при LL_TEST_DATABASE_URL (например postgresql://loadlens:loadlens@localhost:5436/loadlens).
const url = process.env.LL_TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('LoadsService.ingest — параллельные клиенты', () => {
  let sequelize: Sequelize;
  let svc: LoadsService;

  beforeAll(async () => {
    sequelize = new Sequelize(url!, { dialect: 'postgres', logging: false, models: [Load], pool: { max: 8 } });
    await sequelize.sync();
    svc = new LoadsService(Load, sequelize as any);
  });
  afterAll(async () => { await sequelize.close(); });

  const item = (i: number) => ({
    board: 'dat', loadId: `DL${String(i).padStart(4, '0')}`, originMarket: 'CHICAGO_IL', destMarket: 'ATLANTA_GA',
    equipment: 'V', groupKey: 'dat|CHICAGO_IL>ATLANTA_GA|V', rate: 2000 + i, loadedMiles: 700, deadheadMiles: 20,
  }) as any;

  async function deadlocks(): Promise<number> {
    const [[row]] = await sequelize.query(
      `SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`,
    ) as any;
    return Number(row.deadlocks);
  }

  it('не даёт deadlock, когда одна выдача приходит от двух клиентов в разном порядке', async () => {
    const items = Array.from({ length: 150 }, (_, i) => item(i));
    await Load.destroy({ where: { board: 'dat', loadId: items.map((x) => x.loadId) } });
    await svc.ingest({ clientId: 'seed', items } as any); // строки существуют → seen_count UPDATE реально трогает их
    const before = await deadlocks();
    const errors: string[] = [];
    for (let round = 0; round < 40; round++) {
      const shuffled = [...items].sort(() => Math.random() - 0.5);
      await Promise.all([
        svc.ingest({ clientId: 'local', items } as any).catch((e) => errors.push(e.message)),
        svc.ingest({ clientId: 'cloud', items: [...items].reverse() } as any).catch((e) => errors.push(e.message)),
        svc.ingest({ clientId: 'third', items: shuffled } as any).catch((e) => errors.push(e.message)),
      ]);
    }
    expect(errors).toEqual([]);
    expect((await deadlocks()) - before).toBe(0);
  }, 120000);
});
