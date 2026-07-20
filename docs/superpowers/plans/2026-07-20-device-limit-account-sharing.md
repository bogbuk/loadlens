# Device Limit (Account-Sharing Protection) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ограничить Pro-аккаунт тремя устройствами с мягким вытеснением самого давнего, чтобы шеринг подписки стал менее удобным, чем покупка второго места.

**Architecture:** Новая таблица `user_devices` хранит `clientId` установок расширения. Решение «кого вытеснить» вынесено в чистую функцию без БД и Nest — она и покрыта юнитами. Проверка происходит только на `login`/`register`/`refresh`, поэтому JWT остаётся stateless и в горячем пути запросов не появляется ни одного лишнего SQL. Расширение шлёт свой существующий `clientId` в заголовке `X-Client-Id`.

**Tech Stack:** NestJS + Sequelize (`synchronize: true`, миграций нет), Jest для backend, ванильный JS для расширения.

## Global Constraints

- **`DEVICE_LIMIT = 3`.**
- **Вытеснение только при `plan === 'pro'`.** Устройства записываются для всех планов, включая Free — иначе апгрейд Free → Pro застаёт пустую таблицу и выкидывает пользователя со всех машин.
- **Вытеснение = удаление строки**, не флаг. Отдельного состояния «забанен» нет.
- **Проверка только в `login` / `register` / `refresh`.** Никаких обращений к `user_devices` из гардов или обычных эндпоинтов.
- **Порядок вытеснения — по `lastSeenAt`, а не по `createdAt`.**
- **Pro-запрос без заголовка `X-Client-Id` отклоняется** (401, `reason: "client_id_required"`). Free без заголовка работает как раньше.
- **401 несёт машинночитаемый `reason`**, клиент не разбирает текст сообщения.
- **Автоблокировки по счётчику нет.** `device_evictions` — сигнал для владельца, не триггер.
- **Новая колонка добавляется идемпотентным `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` в `main.ts`** — конвенция проекта: `synchronize` не меняет существующие таблицы.
- **Все пользовательские тексты — на английском** (проект переведён; `npm run check:lang` падает на кириллице в user-facing коде). Комментарии в коде — на русском.

---

## File Structure

**Создаются:**
- `backend/src/auth/device-limit.ts` — чистая логика: `DEVICE_LIMIT`, `decideDevices()`. Без импортов Nest и Sequelize.
- `backend/src/auth/device-limit.spec.ts` — юниты на неё.
- `backend/src/auth/user-device.model.ts` — Sequelize-модель `UserDevice`.
- `backend/src/auth/devices.service.ts` — единственное место, знающее и про БД, и про `decideDevices`.
- `backend/src/auth/devices.service.spec.ts` — спеки на сервис с замоканной моделью.

**Модифицируются:**
- `backend/src/users/user.model.ts` — колонка `deviceEvictions`
- `backend/src/main.ts` — `ALTER TABLE users ADD COLUMN IF NOT EXISTS device_evictions`
- `backend/src/auth/auth.module.ts` — регистрация модели и сервиса
- `backend/src/auth/auth.service.ts` — вызовы из `register`/`login`/`refresh`
- `backend/src/auth/auth.controller.ts` — проброс заголовка
- `backend/src/auth/admin.service.ts` — поля в `AdminUserView` и `stats()`
- `backend/public/admin.html` — колонки
- `extension/api.js` — заголовок `X-Client-Id`, сохранение причины разлогина
- `extension/popup.js` — показ причины на экране входа

---

### Task 1: Чистая логика вытеснения

**Files:**
- Create: `backend/src/auth/device-limit.ts`
- Test: `backend/src/auth/device-limit.spec.ts`

**Interfaces:**
- Consumes: ничего
- Produces:
  - `DEVICE_LIMIT = 3`
  - `type DeviceRow = { clientId: string; lastSeenAt: Date }`
  - `decideDevices(devices: DeviceRow[], clientId: string, plan: 'free' | 'pro', now: Date, limit?: number): { keep: DeviceRow[]; evict: DeviceRow[] }`

`devices` — строки, уже лежащие в БД для этого пользователя, БЕЗ учёта текущего входа. Функция сама добавляет текущее устройство с `lastSeenAt = now` (или обновляет, если оно уже есть). Это важно: именно так тест «известное устройство не тратит слот» проверяет реальное поведение, а не тавтологию.

- [ ] **Step 1: Написать падающие тесты**

Создать `backend/src/auth/device-limit.spec.ts`:

```ts
import { DEVICE_LIMIT, decideDevices, DeviceRow } from './device-limit';

const d = (clientId: string, minutesAgo: number): DeviceRow =>
  ({ clientId, lastSeenAt: new Date(Date.parse('2026-07-20T12:00:00Z') - minutesAgo * 60000) });
const NOW = new Date('2026-07-20T12:00:00Z');
const ids = (rows: DeviceRow[]) => rows.map((r) => r.clientId).sort();

describe('decideDevices', () => {
  it('лимит по умолчанию — 3', () => {
    expect(DEVICE_LIMIT).toBe(3);
  });

  it('известное устройство не тратит слот и не вытесняет никого', () => {
    const devices = [d('a', 100), d('b', 50), d('c', 10)];
    const r = decideDevices(devices, 'b', 'pro', NOW);
    expect(r.evict).toEqual([]);
    expect(ids(r.keep)).toEqual(['a', 'b', 'c']);
  });

  it('известное устройство получает свежий lastSeenAt', () => {
    const r = decideDevices([d('a', 100), d('b', 50)], 'b', 'pro', NOW);
    expect(r.keep.find((x) => x.clientId === 'b')!.lastSeenAt).toEqual(NOW);
  });

  it('свободный слот — новое устройство просто добавляется', () => {
    const r = decideDevices([d('a', 100), d('b', 50)], 'c', 'pro', NOW);
    expect(r.evict).toEqual([]);
    expect(ids(r.keep)).toEqual(['a', 'b', 'c']);
  });

  it('переполнение у pro — вытесняется самое давнее по lastSeenAt', () => {
    const devices = [d('old', 500), d('mid', 100), d('new', 10)];
    const r = decideDevices(devices, 'fresh', 'pro', NOW);
    expect(ids(r.evict)).toEqual(['old']);
    expect(ids(r.keep)).toEqual(['fresh', 'mid', 'new']);
  });

  it('порядок вытеснения — по lastSeenAt, а не по порядку в массиве', () => {
    const devices = [d('recent', 5), d('ancient', 9999), d('mid', 100)];
    const r = decideDevices(devices, 'fresh', 'pro', NOW);
    expect(ids(r.evict)).toEqual(['ancient']);
  });

  it('переполнение у free — не вытесняем ничего', () => {
    const devices = [d('a', 500), d('b', 100), d('c', 10)];
    const r = decideDevices(devices, 'dd', 'free', NOW);
    expect(r.evict).toEqual([]);
    expect(r.keep).toHaveLength(4);
  });

  it('апгрейд free→pro с пятью устройствами подрезает до трёх самых свежих', () => {
    const devices = [d('a', 500), d('b', 400), d('c', 300), d('d', 200), d('e', 100)];
    const r = decideDevices(devices, 'e', 'pro', NOW);
    expect(ids(r.evict)).toEqual(['a', 'b']);
    expect(ids(r.keep)).toEqual(['c', 'd', 'e']);
  });

  it('текущее устройство не вытесняется никогда, даже если его строка была самой старой', () => {
    const devices = [d('me', 9999), d('b', 100), d('c', 50), d('dd', 10)];
    const r = decideDevices(devices, 'me', 'pro', NOW);
    expect(r.evict.map((x) => x.clientId)).not.toContain('me');
    expect(r.keep).toHaveLength(3);
  });

  it('пустой список устройств — первое устройство просто добавляется', () => {
    const r = decideDevices([], 'a', 'pro', NOW);
    expect(r.evict).toEqual([]);
    expect(ids(r.keep)).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Запустить тесты, убедиться что падают**

Run: `cd backend && npx jest src/auth/device-limit.spec.ts`
Expected: FAIL — `Cannot find module './device-limit'`

- [ ] **Step 3: Написать реализацию**

Создать `backend/src/auth/device-limit.ts`:

```ts
/* Решение «какие устройства оставить, какие вытеснить» — чистая функция, без БД и Nest.
   Вынесена отдельно, чтобы правило лимита тестировалось без моков и инфраструктуры. */

export const DEVICE_LIMIT = 3;

export type DeviceRow = { clientId: string; lastSeenAt: Date };

// devices — строки из БД БЕЗ учёта текущего входа; текущее устройство функция добавляет сама.
// Вытесняем только у pro (у free просто копим — иначе апгрейд free→pro выкинет со всех машин).
export function decideDevices(
  devices: DeviceRow[],
  clientId: string,
  plan: 'free' | 'pro',
  now: Date,
  limit: number = DEVICE_LIMIT,
): { keep: DeviceRow[]; evict: DeviceRow[] } {
  const others = (devices || []).filter((d) => d.clientId !== clientId);
  const merged: DeviceRow[] = [...others, { clientId, lastSeenAt: now }];

  if (plan !== 'pro' || merged.length <= limit) return { keep: merged, evict: [] };

  // Самые давние — первыми на вылет. Текущее устройство исключено по построению: у него lastSeenAt = now.
  const byAge = [...merged].sort((a, b) => a.lastSeenAt.getTime() - b.lastSeenAt.getTime());
  const evict = byAge.slice(0, merged.length - limit);
  const evicted = new Set(evict.map((d) => d.clientId));
  return { keep: merged.filter((d) => !evicted.has(d.clientId)), evict };
}
```

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `cd backend && npx jest src/auth/device-limit.spec.ts`
Expected: PASS, 10 тестов

- [ ] **Step 5: Коммит**

```bash
git add backend/src/auth/device-limit.ts backend/src/auth/device-limit.spec.ts
git commit -m "feat(auth): чистое правило лимита устройств (decideDevices)"
```

---

### Task 2: Модель устройства и колонка счётчика

**Files:**
- Create: `backend/src/auth/user-device.model.ts`
- Modify: `backend/src/users/user.model.ts` (добавить колонку в конец класса)
- Modify: `backend/src/main.ts` (рядом с остальными `ALTER TABLE users`)
- Modify: `backend/src/auth/auth.module.ts`

**Interfaces:**
- Consumes: ничего из Task 1
- Produces:
  - класс `UserDevice` с полями `id`, `userId`, `clientId`, `lastSeenAt`
  - `User.deviceEvictions: number`

- [ ] **Step 1: Создать модель**

Создать `backend/src/auth/user-device.model.ts`:

```ts
import { Column, DataType, Model, Table } from 'sequelize-typescript';

// Устройства аккаунта: одна строка = одна установка расширения (clientId из chrome.storage.local).
// Вытеснение сверх лимита — удаление строки, отдельного состояния «забанен» нет.
@Table({
  tableName: 'user_devices',
  underscored: true,
  timestamps: true,
  indexes: [{ name: 'uniq_user_client', unique: true, fields: ['user_id', 'client_id'] }],
})
export class UserDevice extends Model {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  id: string;

  @Column({ type: DataType.UUID, allowNull: false, field: 'user_id' })
  userId: string;

  @Column({ type: DataType.TEXT, allowNull: false, field: 'client_id' })
  clientId: string;

  @Column({ type: DataType.DATE, allowNull: false, field: 'last_seen_at' })
  lastSeenAt: Date;
}
```

- [ ] **Step 2: Добавить колонку счётчика в `User`**

В `backend/src/users/user.model.ts`, после блока `tokenVersion`, добавить:

```ts
  // Сколько раз у аккаунта вытеснялось устройство сверх лимита. Сигнал шеринга для админки;
  // автоматических действий по нему НЕ предпринимаем.
  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'device_evictions' })
  deviceEvictions: number;
```

- [ ] **Step 3: Добавить идемпотентный ALTER**

В `backend/src/main.ts`, следом за строкой с `token_version`, добавить:

```ts
  await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS device_evictions INTEGER NOT NULL DEFAULT 0');
```

- [ ] **Step 4: Зарегистрировать модель в модуле**

В `backend/src/auth/auth.module.ts` добавить импорты и `SequelizeModule.forFeature`:

```ts
import { SequelizeModule } from '@nestjs/sequelize';
import { UserDevice } from './user-device.model';
```

и в массив `imports` — первым элементом:

```ts
    SequelizeModule.forFeature([UserDevice]),
```

- [ ] **Step 5: Собрать и убедиться, что ничего не сломано**

Run: `cd backend && npm run build && npm test`
Expected: сборка без ошибок, все существующие тесты PASS (137 на момент написания плана)

- [ ] **Step 6: Коммит**

```bash
git add backend/src/auth/user-device.model.ts backend/src/users/user.model.ts backend/src/main.ts backend/src/auth/auth.module.ts
git commit -m "feat(auth): таблица user_devices + счётчик device_evictions"
```

---

### Task 3: Сервис устройств

**Files:**
- Create: `backend/src/auth/devices.service.ts`
- Test: `backend/src/auth/devices.service.spec.ts`
- Modify: `backend/src/auth/auth.module.ts` (провайдер)

**Interfaces:**
- Consumes: `decideDevices`, `DEVICE_LIMIT`, `DeviceRow` из Task 1; `UserDevice` из Task 2; `User` из `../users/user.model`
- Produces:
  - `DevicesService.registerOnAuth(user: User, clientId: string | null): Promise<void>` — для `login` и `register`
  - `DevicesService.verifyOnRefresh(user: User, clientId: string | null): Promise<void>` — для `refresh`
  - обе бросают `UnauthorizedException` с телом `{ message: string; reason: string }`

Причины (`reason`): `client_id_required` — Pro-запрос без заголовка; `device_limit` — устройство вытеснено.

- [ ] **Step 1: Написать падающие тесты**

Создать `backend/src/auth/devices.service.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { DevicesService } from './devices.service';

const proUser = () => ({ id: 'u1', plan: 'pro', deviceEvictions: 0 }) as any;
const freeUser = () => ({ id: 'u1', plan: 'free', deviceEvictions: 0 }) as any;

function makeService(rows: any[]) {
  const model = {
    findAll: jest.fn().mockResolvedValue(rows),
    upsert: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(rows.length),
    findOne: jest.fn().mockImplementation(({ where }) =>
      Promise.resolve(rows.find((r) => r.clientId === where.clientId) ?? null)),
  };
  const users = { increment: jest.fn().mockResolvedValue(undefined) };
  return { svc: new DevicesService(model as any, users as any), model, users };
}

const row = (clientId: string, minutesAgo: number) =>
  ({ clientId, lastSeenAt: new Date(Date.now() - minutesAgo * 60000) });

describe('DevicesService.registerOnAuth', () => {
  it('pro без clientId — 401 client_id_required', async () => {
    const { svc } = makeService([]);
    await expect(svc.registerOnAuth(proUser(), null)).rejects.toMatchObject({
      response: { reason: 'client_id_required' },
    });
  });

  it('free без clientId — проходит молча, ничего не пишем', async () => {
    const { svc, model } = makeService([]);
    await expect(svc.registerOnAuth(freeUser(), null)).resolves.toBeUndefined();
    expect(model.upsert).not.toHaveBeenCalled();
  });

  it('свободный слот — устройство пишется, вытеснения нет', async () => {
    const { svc, model, users } = makeService([row('a', 100)]);
    await svc.registerOnAuth(proUser(), 'b');
    expect(model.upsert).toHaveBeenCalled();
    expect(model.destroy).not.toHaveBeenCalled();
    expect(users.increment).not.toHaveBeenCalled();
  });

  it('переполнение у pro — самое давнее удаляется, счётчик растёт на число вытесненных', async () => {
    const { svc, model, users } = makeService([row('old', 500), row('mid', 100), row('new', 10)]);
    await svc.registerOnAuth(proUser(), 'fresh');
    expect(model.destroy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'u1', clientId: ['old'] }) }),
    );
    expect(users.increment).toHaveBeenCalledWith('deviceEvictions', { by: 1, where: { id: 'u1' } });
  });

  it('переполнение у free — не удаляем и не считаем', async () => {
    const { svc, model, users } = makeService([row('a', 500), row('b', 100), row('c', 10)]);
    await svc.registerOnAuth(freeUser(), 'dd');
    expect(model.destroy).not.toHaveBeenCalled();
    expect(users.increment).not.toHaveBeenCalled();
  });
});

describe('DevicesService.verifyOnRefresh', () => {
  it('pro без clientId — 401 client_id_required', async () => {
    const { svc } = makeService([]);
    await expect(svc.verifyOnRefresh(proUser(), null)).rejects.toMatchObject({
      response: { reason: 'client_id_required' },
    });
  });

  it('pro с неизвестным устройством — 401 device_limit', async () => {
    const { svc } = makeService([row('a', 10)]);
    await expect(svc.verifyOnRefresh(proUser(), 'gone')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(svc.verifyOnRefresh(proUser(), 'gone')).rejects.toMatchObject({
      response: { reason: 'device_limit' },
    });
  });

  it('pro с известным устройством — проходит и освежает lastSeenAt', async () => {
    const { svc, model } = makeService([row('a', 10)]);
    await expect(svc.verifyOnRefresh(proUser(), 'a')).resolves.toBeUndefined();
    expect(model.upsert).toHaveBeenCalled();
  });

  it('free с неизвестным устройством — не отказываем, просто пишем', async () => {
    const { svc, model } = makeService([]);
    await expect(svc.verifyOnRefresh(freeUser(), 'whatever')).resolves.toBeUndefined();
    expect(model.upsert).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Запустить тесты, убедиться что падают**

Run: `cd backend && npx jest src/auth/devices.service.spec.ts`
Expected: FAIL — `Cannot find module './devices.service'`

- [ ] **Step 3: Написать сервис**

Создать `backend/src/auth/devices.service.ts`:

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { User } from '../users/user.model';
import { UserDevice } from './user-device.model';
import { DEVICE_LIMIT, DeviceRow, decideDevices } from './device-limit';

// Тексты видит пользователь на экране входа в попапе — только английский.
const MSG_CLIENT_ID = 'Please update the LoadLens extension to continue.';
const MSG_EVICTED = 'Signed out — your account was used on another device. Pro covers up to 3 devices.';

function deny(reason: 'client_id_required' | 'device_limit'): never {
  throw new UnauthorizedException({
    message: reason === 'client_id_required' ? MSG_CLIENT_ID : MSG_EVICTED,
    reason,
  });
}

@Injectable()
export class DevicesService {
  constructor(
    @InjectModel(UserDevice) private readonly devices: typeof UserDevice,
    @InjectModel(User) private readonly users: typeof User,
  ) {}

  // upsert опирается на уникальный индекс (user_id, client_id) — Sequelize строит по нему
  // ON CONFLICT. Если на конкретной версии Sequelize он не подхватит составной индекс и
  // упадёт с ошибкой конфликта, заменить на findOne + create/update (поведение то же).
  private async touch(userId: string, clientId: string): Promise<void> {
    await this.devices.upsert({ userId, clientId, lastSeenAt: new Date() });
  }

  // login / register: регистрируем устройство и подрезаем список до лимита (только для pro).
  async registerOnAuth(user: User, clientId: string | null): Promise<void> {
    if (!clientId) {
      if (user.plan === 'pro') deny('client_id_required');
      return; // free без заголовка (старая сборка расширения) — работает как раньше
    }
    const rows = await this.devices.findAll({ where: { userId: user.id } });
    const current: DeviceRow[] = rows.map((r) => ({ clientId: r.clientId, lastSeenAt: r.lastSeenAt }));
    const { evict } = decideDevices(current, clientId, user.plan, new Date(), DEVICE_LIMIT);

    await this.touch(user.id, clientId);
    if (!evict.length) return;

    await this.devices.destroy({ where: { userId: user.id, clientId: evict.map((d) => d.clientId) } });
    await this.users.increment('deviceEvictions', { by: evict.length, where: { id: user.id } });
  }

  // refresh: у pro устройство обязано быть в таблице; отсутствие строки = его вытеснили.
  async verifyOnRefresh(user: User, clientId: string | null): Promise<void> {
    if (!clientId) {
      if (user.plan === 'pro') deny('client_id_required');
      return;
    }
    if (user.plan === 'pro') {
      const known = await this.devices.findOne({ where: { userId: user.id, clientId } });
      if (!known) deny('device_limit');
    }
    await this.touch(user.id, clientId);
  }
}
```

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `cd backend && npx jest src/auth/devices.service.spec.ts`
Expected: PASS, 9 тестов

- [ ] **Step 5: Зарегистрировать провайдер**

В `backend/src/auth/auth.module.ts` добавить импорт `import { DevicesService } from './devices.service';` и вписать `DevicesService` в массив `providers`.

Модель `User` уже доступна модулю через `UsersModule` — если сборка пожалуется на отсутствие провайдера `UserModel`, добавить `User` в существующий `SequelizeModule.forFeature([UserDevice])`, сделав его `forFeature([UserDevice, User])`.

- [ ] **Step 6: Собрать**

Run: `cd backend && npm run build`
Expected: без ошибок

- [ ] **Step 7: Коммит**

```bash
git add backend/src/auth/devices.service.ts backend/src/auth/devices.service.spec.ts backend/src/auth/auth.module.ts
git commit -m "feat(auth): DevicesService — регистрация устройства и проверка на refresh"
```

---

### Task 4: Подключение к auth-потоку и заголовок

**Files:**
- Modify: `backend/src/auth/auth.service.ts` (`register`, `login`, `refresh`)
- Modify: `backend/src/auth/auth.controller.ts` (чтение заголовка)

**Interfaces:**
- Consumes: `DevicesService.registerOnAuth(user, clientId)`, `DevicesService.verifyOnRefresh(user, clientId)` из Task 3
- Produces: методы `AuthService.register/login/refresh` получают дополнительный последний параметр `clientId: string | null`

- [ ] **Step 1: Добавить `DevicesService` в конструктор `AuthService`**

В `backend/src/auth/auth.service.ts` добавить импорт `import { DevicesService } from './devices.service';` и параметр конструктора:

```ts
    private readonly devices: DevicesService,
```

- [ ] **Step 2: Прокинуть `clientId` в три метода**

`register` — сигнатура становится `async register(emailRaw: string, password: string, clientId: string | null)`; после `const user = await this.userModel.create({ email, passwordHash });` добавить:

```ts
    await this.devices.registerOnAuth(user, clientId);
```

`login` — сигнатура `async login(emailRaw: string, password: string, clientId: string | null)`; перед `return { ...(await this.tokens(user)), ... }` добавить ту же строку:

```ts
    await this.devices.registerOnAuth(user, clientId);
```

`refresh` — сигнатура `async refresh(refreshToken: string, clientId: string | null)`; после проверки `tokenVersion` и перед `return` добавить:

```ts
    await this.devices.verifyOnRefresh(user, clientId);
```

Порядок важен: проверка устройства идёт ПОСЛЕ проверки пароля/токена и блокировки. Иначе эндпоинт станет оракулом, по которому можно перебирать существование аккаунтов.

- [ ] **Step 3: Читать заголовок в контроллере**

В `backend/src/auth/auth.controller.ts` добавить `Headers` в импорт из `@nestjs/common` и поменять три метода:

```ts
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  register(@Body() dto: CredentialsDto, @Headers('x-client-id') clientId?: string) {
    return this.service.register(dto.email, dto.password, clientId || null);
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  login(@Body() dto: CredentialsDto, @Headers('x-client-id') clientId?: string) {
    return this.service.login(dto.email, dto.password, clientId || null);
  }

  @Post('refresh')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  refresh(@Body() dto: RefreshDto, @Headers('x-client-id') clientId?: string) {
    return this.service.refresh(dto.refreshToken, clientId || null);
  }
```

Имя заголовка в декораторе — в нижнем регистре: Node нормализует заголовки к lowercase.

- [ ] **Step 4: Починить существующие спеки**

`backend/src/auth/auth.service.spec.ts` конструирует `AuthService` напрямую и вызывает `login`/`register`/`refresh`. Добавить в конструктор заглушку сервиса устройств и передать `null` третьим аргументом в вызовы:

```ts
const devicesStub = { registerOnAuth: jest.fn(), verifyOnRefresh: jest.fn() } as any;
```

Названия тест-кейсов остаются русскими — они вне объёма перевода.

- [ ] **Step 5: Прогнать backend-тесты**

Run: `cd backend && npm run build && npm test`
Expected: сборка чистая, все тесты PASS

- [ ] **Step 6: Коммит**

```bash
git add backend/src/auth/auth.service.ts backend/src/auth/auth.controller.ts backend/src/auth/auth.service.spec.ts
git commit -m "feat(auth): проверка устройства в login/register/refresh, заголовок X-Client-Id"
```

---

### Task 5: Клиент — заголовок и причина разлогина

**Files:**
- Modify: `extension/api.js` (`credsCall`, `refreshTokens`, экспорт)
- Modify: `extension/popup.js:361-363` (стартовый рендер аккаунта)

**Interfaces:**
- Consumes: 401 с телом `{ message, reason }` из Task 3/4
- Produces: `LLAPI.takeSignoutMessage(): Promise<string>` — возвращает и очищает отложенное сообщение о разлогине (пустая строка, если его нет)

- [ ] **Step 1: Слать заголовок в `credsCall`**

В `extension/api.js` заменить тело `credsCall`:

```js
  async function credsCall(path, email, password) {
    const cid = await clientId();
    const res = await fetch(`${BASE}/auth/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Client-Id": cid },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `error ${res.status}`);
    await setAuth({ accessToken: data.accessToken, refreshToken: data.refreshToken,
                    email: data.user.email, plan: data.user.plan, planTs: Date.now() });
    return data.user;
  }
```

- [ ] **Step 2: Слать заголовок в `refreshTokens` и запоминать причину**

Заменить тело `refreshTokens`:

```js
  async function refreshTokens(auth) {
    const cid = await clientId();
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Client-Id": cid },
      body: JSON.stringify({ refreshToken: auth.refreshToken }),
    });
    if (!res.ok) {
      // Причину разлогина сохраняем отдельно: попап покажет её на экране входа.
      // Различать «токен протух» и «вытеснили» по тексту нельзя — только по reason.
      const data = await res.json().catch(() => ({}));
      if (data.reason) await chrome.storage.local.set({ ll_signout: data.message || "" });
      await logout();
      return null;
    }
    const data = await res.json();
    const next = { ...auth, accessToken: data.accessToken, refreshToken: data.refreshToken };
    await setAuth(next);
    return next;
  }
```

- [ ] **Step 3: Добавить `takeSignoutMessage`**

В `extension/api.js`, рядом с `logout`, добавить:

```js
  // Забирает отложенное сообщение о разлогине и стирает его — показывается один раз.
  async function takeSignoutMessage() {
    const { ll_signout } = await chrome.storage.local.get("ll_signout");
    if (ll_signout) await chrome.storage.local.remove("ll_signout");
    return ll_signout || "";
  }
```

и вписать `takeSignoutMessage` в объект, который возвращает модуль (там же, где перечислены `sanitizeLoad, clientId, sendLoads, ...`).

- [ ] **Step 4: Показать сообщение в попапе**

В `extension/popup.js` заменить стартовый рендер (строки 361-363):

```js
LLAPI.getMe().then(
  async (u) => {
    if (u) accRow(u); else accForm(await LLAPI.takeSignoutMessage());
    renderFleet(u || null); renderTelegram(u || null);
  },
  async () => { accForm(await LLAPI.takeSignoutMessage()); renderFleet(null); renderTelegram(null); },
);
```

`accForm(err)` уже рендерит переданную строку в блок `.err` — нового UI не требуется.

- [ ] **Step 5: Проверить**

Run: `npm test`
Expected: PASS — `check:lang` чисто (все новые строки английские либо русские комментарии), тесты скрипта, shared и extension зелёные.

- [ ] **Step 6: Коммит**

```bash
git add extension/api.js extension/popup.js
git commit -m "feat(extension): заголовок X-Client-Id и показ причины разлогина"
```

---

### Task 6: Видимость шеринга в админке

**Files:**
- Modify: `backend/src/auth/admin.service.ts` (`AdminUserView`, `view`, `stats`)
- Modify: `backend/public/admin.html`

**Interfaces:**
- Consumes: `User.deviceEvictions` из Task 2, `UserDevice` из Task 2
- Produces: поля `devices` и `deviceEvictions` в каждом элементе ответа `GET /admin/users`, поле `evictions` в `GET /admin/users/stats`

- [ ] **Step 1: Расширить представление пользователя**

В `backend/src/auth/admin.service.ts`:

добавить импорт `import { UserDevice } from './user-device.model';`, в конструктор — `@InjectModel(UserDevice) private readonly devices: typeof UserDevice,`.

В интерфейс `AdminUserView` добавить два поля:

```ts
  devices: number;
  deviceEvictions: number;
```

Метод `view` принимает второй аргумент — число устройств:

```ts
  private view(u: User, devices = 0): AdminUserView {
    return {
      email: u.email,
      plan: u.plan,
      role: u.role,
      blocked: u.blocked,
      telegramLinked: !!u.telegramChatId,
      alertsEnabled: u.alertsEnabled,
      devices,
      deviceEvictions: u.deviceEvictions ?? 0,
      createdAt: (u as any).createdAt,
    };
  }
```

- [ ] **Step 2: Считать устройства одним запросом**

Заменить тело `listUsers`:

```ts
  async listUsers(q?: string): Promise<AdminUserView[]> {
    const where = q ? { email: { [Op.iLike]: `%${q.trim().toLowerCase()}%` } } : undefined;
    const rows = await this.userModel.findAll({ where, order: [['createdAt', 'DESC']] });
    // Одним запросом на всю страницу, а не N+1 по пользователям.
    const counts = await this.devices.findAll({
      attributes: ['userId', [fn('COUNT', col('id')), 'n']],
      where: { userId: rows.map((u) => u.id) },
      group: ['user_id'],
      raw: true,
    }) as unknown as Array<{ userId: string; n: string }>;
    const byUser = new Map(counts.map((c) => [c.userId, Number(c.n)]));
    return rows.map((u) => this.view(u, byUser.get(u.id) ?? 0));
  }
```

Импорт агрегатов дополнить: `import { Op, col, fn } from 'sequelize';`

- [ ] **Step 3: Добавить сводку в `stats`**

Заменить тело `stats`:

```ts
  async stats() {
    const [users, proUsers, blockedUsers, evictions, overview] = await Promise.all([
      this.userModel.count(),
      this.userModel.count({ where: { plan: 'pro' } }),
      this.userModel.count({ where: { blocked: true } }),
      this.userModel.sum('deviceEvictions'),
      this.lanes.overview(),
    ]);
    return { users, proUsers, blockedUsers, evictions: evictions ?? 0, ...overview };
  }
```

`sum` возвращает `null` на пустой таблице — отсюда `?? 0`.

- [ ] **Step 4: Показать колонки в админке**

Страница `backend/public/admin.html` осталась русскоязычной (она вне объёма перевода), поэтому новые подписи пиши по-русски — иначе таблица станет наполовину английской.

Строка 63 — заголовок таблицы. Вставить две ячейки после `<th>План</th>`:

```html
        <th>Email</th><th>Роль</th><th>План</th><th>Устройств</th><th>Вытеснений</th><th>Статус</th><th>TG</th><th>Алерты</th><th>Создан</th><th></th>
```

Строки 141-148 — рендер строки. Вставить две ячейки после `<td>` с планом (строка 144), сохранив остальные без изменений:

```html
          <td>${u.devices ?? 0}</td>
          <td${u.deviceEvictions > 0 ? ' style="color:#c00;font-weight:600"' : ''}>${u.deviceEvictions ?? 0}</td>
```

Выделение цветом при `deviceEvictions > 0` — единственный способ увидеть шеринг взглядом, не вчитываясь в числа.

Строки 128-133 — карточки сводки. Добавить карточку вытеснений в массив, после `['Заблокировано', ...]`:

```js
        ['Вытеснений', s.evictions ?? '—'],
```

- [ ] **Step 5: Собрать и прогнать тесты**

Run: `cd backend && npm run build && npm test`
Expected: сборка чистая, все тесты PASS

- [ ] **Step 6: Коммит**

```bash
git add backend/src/auth/admin.service.ts backend/public/admin.html
git commit -m "feat(admin): колонки устройств и вытеснений — видимость шеринга"
```

---

### Task 7: Проверка на живой БД и релиз

**Files:**
- Modify: `extension/manifest.json` (версия)
- Modify: `CHANGELOG.md`
- Create: `tasks/0010-device-limit.md`

**Interfaces:**
- Consumes: всё предыдущее
- Produces: собранный пакет расширения

- [ ] **Step 1: Поднять локальную БД и приложение**

```bash
cd backend && docker compose -p loadlens up -d && npm run build && npm run start:prod
```
Expected: приложение стартует, в логах видно применение `ALTER TABLE users ADD COLUMN IF NOT EXISTS device_evictions`

- [ ] **Step 2: Проверить сценарий вытеснения руками**

В другом терминале зарегистрировать пользователя и войти с четырёх разных `X-Client-Id`:

```bash
API=http://localhost:3000/api/v1
curl -s -X POST $API/auth/register -H 'Content-Type: application/json' -H 'X-Client-Id: dev-1' -d '{"email":"seat@test.local","password":"password123"}' | head -c 120
for i in 2 3 4; do
  curl -s -X POST $API/auth/login -H 'Content-Type: application/json' -H "X-Client-Id: dev-$i" -d '{"email":"seat@test.local","password":"password123"}' > /tmp/ll-login-$i.json
done
```

Пользователь пока `free`, поэтому вытеснения быть не должно — в таблице четыре строки:

```bash
docker exec -i $(docker ps -qf name=loadlens) psql -U loadlens -d loadlens -c \
  "select client_id, last_seen_at from user_devices order by last_seen_at;"
```
Expected: 4 строки (`dev-1`..`dev-4`)

- [ ] **Step 3: Перевести в Pro и убедиться, что подрезка сработала**

```bash
docker exec -i $(docker ps -qf name=loadlens) psql -U loadlens -d loadlens -c \
  "update users set plan='pro' where email='seat@test.local';"
curl -s -X POST $API/auth/login -H 'Content-Type: application/json' -H 'X-Client-Id: dev-4' -d '{"email":"seat@test.local","password":"password123"}' > /dev/null
docker exec -i $(docker ps -qf name=loadlens) psql -U loadlens -d loadlens -c \
  "select client_id from user_devices order by last_seen_at; select device_evictions from users where email='seat@test.local';"
```
Expected: осталось 3 устройства (`dev-1` вытеснен как самый давний), `device_evictions = 1`

- [ ] **Step 4: Убедиться, что вытеснённое устройство получает нужный `reason`**

Взять refreshToken вытесненного устройства из `/tmp/ll-login-2.json` и дёрнуть refresh с его `X-Client-Id`, предварительно вытеснив его входами с других устройств:

```bash
RT=$(node -e 'console.log(require("/tmp/ll-login-2.json").refreshToken)')
curl -s -X POST $API/auth/refresh -H 'Content-Type: application/json' -H 'X-Client-Id: dev-2' -d "{\"refreshToken\":\"$RT\"}"
```
Expected (после того как `dev-2` вытеснен): `{"message":"Signed out — your account was used on another device. Pro covers up to 3 devices.","reason":"device_limit","statusCode":401}`

- [ ] **Step 5: Убедиться, что Pro без заголовка отклоняется**

```bash
curl -s -X POST $API/auth/login -H 'Content-Type: application/json' -d '{"email":"seat@test.local","password":"password123"}'
```
Expected: `{"message":"Please update the LoadLens extension to continue.","reason":"client_id_required","statusCode":401}`

- [ ] **Step 6: Поднять версию и записать в CHANGELOG**

В `extension/manifest.json` поставить `"version": "0.5.0"`.

В `CHANGELOG.md` над записью `## 0.4.0` добавить:

```markdown
## 0.5.0 — 2026-07-20

### Changed
- **A Pro subscription now covers up to 3 devices.** Signing in on a fourth device signs out the one you haven't used in the longest time. If that happens, the sign-in screen tells you why.
```

Дату заменить на фактическую дату выполнения задачи.

- [ ] **Step 7: Собрать пакет**

Run: `npm run package:ext`
Expected: `dist/loadlens-extension-0.5.0.zip`, 28 файлов

- [ ] **Step 8: Завести файл задачи**

Создать `tasks/0010-device-limit.md`:

```markdown
# Task: лимит устройств — защита Pro-подписки от шеринга
Date: 2026-07-20
Status: done

## Checklist
- [x] чистое правило decideDevices + юниты
- [x] таблица user_devices + колонка device_evictions
- [x] DevicesService (registerOnAuth / verifyOnRefresh)
- [x] подключение к login/register/refresh + заголовок X-Client-Id
- [x] клиент: заголовок и показ причины разлогина
- [x] админка: колонки устройств и вытеснений
### Verification
- [x] npm test
- [x] backend build + test
- [x] ручная проверка на локальной БД (вытеснение, reason, client_id_required)
- [x] commit
```

Дату заменить на фактическую.

- [ ] **Step 9: Коммит**

```bash
git add extension/manifest.json CHANGELOG.md tasks/0010-device-limit.md
git commit -m "chore(release): 0.5.0 — лимит устройств"
```

---

## Что вне этого плана

- **Экран управления устройствами** в попапе — договорились на мягкое вытеснение без UI.
- **Детекция одновременных сессий** (один `clientId` работает из двух мест) — следующий шаг, если `device_evictions` покажет, что шеринг массовый. Строится на тех же данных, без переделки сделанного.
- **Интеграция с биллингом** — `plan` по-прежнему выставляется вручную через `PATCH /admin/users/:email/plan`.
- **Автоблокировка по счётчику вытеснений** — сознательно не делаем.
