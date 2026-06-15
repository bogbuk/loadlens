# Дизайн: парк водителей диспетчера (driver fleet)

Date: 2026-06-15
Status: approved (design)

## Проблема

LoadLens спроектирован под **одного** водителя: в `extension/content.js` единственные
`hosState`, `currentMarket`, `costPerMile`; `extension/hos.js` хранит одно HOS-состояние в
`chrome.storage.local` под ключом `ll_hos`. Get-out цепочки и скоринг считаются под этого
одного водителя.

Диспетчер ведёт **несколько** своих водителей и должен переключаться между ними, чтобы скоринг
выгодности и get-out цепочки пересчитывались под рынок / HOS-часы / прицеп / себестоимость
выбранного водителя.

## Решение (scope)

Вариант **A**: профили водителей на бэкенде (привязка к JWT-аккаунту диспетчера), быстрый
переключатель активного водителя в шапке плавающей панели, полное управление парком (CRUD) —
в `popup`. Переключение активного водителя пересчитывает скоринг и цепочки.

**YAGNI-срез (согласовано):**
- `homeBase` — хранится, но в скоринг/ранжирование цепочек пока **не вносится** (механика «тяга
  домой» — отдельная фаза 2).
- `status` — чисто визуальный маркер в списке, без логики назначений грузов.
- Лимита на число водителей нет (free и pro одинаково).
- **Без логина расширение работает по-старому** (аноним-режим). Парк — надстройка для
  залогиненного диспетчера, а не замена базового поведения.

Не входит (отдельные фичи): матчинг «груз→лучший водитель» по всей выдаче, назначение/трекинг
грузов, история, мультидевайс-синхрон выбора активного водителя.

## Backend: модуль `drivers`

Новый модуль `backend/src/drivers/` по конвенции `model → dto → service → controller → module`.
Все эндпоинты под `JwtAuthGuard` (кладёт `req.user.userId`); скоуп каждого запроса —
`where: { id, userId }`, чужой водитель → 404.

### Модель `Driver` (`drivers`, `underscored`, `timestamps`)

| поле | тип | назначение |
|---|---|---|
| `id` | UUID PK (UUIDV4) | |
| `userId` | UUID, FK→`users`, **ON DELETE CASCADE** | владелец-диспетчер |
| `name` | TEXT, NOT NULL | метка водителя |
| `currentMarket` | TEXT, nullable | `CITY_ST`, origin для цепочек |
| `equipment` | ENUM `V/R/F/SD/PO`, nullable | фильтр грузов |
| `costPerMile` | FLOAT, nullable | break-even скоринга (фолбэк — общий по парку) |
| `homeBase` | TEXT, nullable | хранится, в скоринг пока не идёт |
| `status` | ENUM `active/available/off`, default `available` | визуальный маркер |
| `hos` | JSONB | `{ remainingDrive, remainingOnDuty, remainingCycle }` в минутах |

Модель регистрируется в `app.module` — `synchronize:true` создаёт таблицу сам (миграций нет).
FK-каскад: при `DELETE /users/me` водители удаляются автоматически.

### Эндпоинты (`/api/v1/drivers`)

- `GET /drivers` — список водителей текущего диспетчера.
- `POST /drivers` — создать. DTO под `ValidationPipe` (whitelist): `name` обяз.; `equipment`,
  `status` — enum; `currentMarket`, `homeBase` — строки; `costPerMile` — число; `hos` — объект
  трёх чисел (или дефолт «свежий»).
- `PATCH /drivers/:id` — частичное обновление любого поля (рынок / HOS / статус / …).
- `DELETE /drivers/:id` — удалить.

`DriversService` все операции фильтрует по `userId`.

## Extension

### `api.js` (LLAPI)

4 authed-метода с `Bearer` + авто-refresh (паттерн существующего `getMe`): `getDrivers()`,
`createDriver(d)`, `updateDriver(id, patch)`, `deleteDriver(id)`. Без токена → «не залогинен».

### `drivers.js` (новый модуль LLDRV)

Тонкий клиентский слой: кэш списка водителей + выбор активного. Активный водитель — **per-device**,
хранится локально: `chrome.storage.local` ключ `ll_active_driver = <driverId>`.
API: `getActive()`, `setActive(id)`, плюс чистая функция выбора контекста (см. ниже).

### `content.js` — развязка источника

Сейчас планировщик и скоринг питаются локальными `hosState/currentMarket/costPerMile`
(`equipment` нигде). Становится:

1. При загрузке — `LLAPI.getDrivers()`.
2. Чистая функция `resolveDriverContext(activeDriver, loads)` → `{ start, hos, equipment,
   costPerMile }` с фолбэками.
3. Контекст питает `LLPLAN.plan` (`market → start`, `hos → hosState`, `equipment → фильтр`,
   `costPerMile → break-even`) и построчный скоринг.

**Обратная совместимость:**
- не залогинен / парк пуст → аноним-режим: локальный `ll_hos`, авто-рынок (`topOriginMarket`),
  общий `costPerMile`. Свитчер скрыт.
- залогинен, ≥1 водитель → в шапке панели `<select>` водителя; смена → `LLDRV.setActive(id)` +
  `render()` (пересчёт скоринга и цепочек).

### `popup.html` / `popup.js` — секция «Парк»

Под существующей секцией `account`: список водителей (имя · рынок · equipment · статус) с
кнопками добавить / редактировать / удалить → вызовы `LLAPI`. Видна только залогиненному; иначе
подсказка «войдите, чтобы вести парк». Текущая одиночная форма HOS/cost остаётся фолбэк-настройками
для анонима.

## Поток данных

```
popup (CRUD парка) ──► backend /drivers ──► content.js getDrivers()
                                                  │
                                       resolveDriverContext(active, loads)
                                                  │
                                   LLPLAN.plan + построчный скоринг ──► панель
```

Свитчер в шапке меняет только локальный `ll_active_driver` и перерисовывает панель.

## Тестирование

**Backend** (`drivers.service.spec.ts`): изоляция по `userId` (чужого водителя не
получить / не изменить / не удалить → 404); CRUD happy-path.

**Extension** — чистая `resolveDriverContext(activeDriver, loads)` (без DOM/сети), краевые случаи:
- `ll_active_driver` указывает на удалённого водителя → фолбэк на первого в списке;
- парк пуст / не залогинен → аноним-режим (локальный `ll_hos`, авто-рынок);
- пустой `currentMarket` → фолбэк `topOriginMarket`; пустой `equipment` → без фильтра.

## Затронутые файлы

- **new** `backend/src/drivers/{driver.model.ts, dto/*, drivers.service.ts,
  drivers.controller.ts, drivers.module.ts, drivers.service.spec.ts}`
- **edit** `backend/src/app.module.ts` (регистрация модели/модуля)
- **new** `extension/drivers.js` (LLDRV)
- **edit** `extension/api.js` (CRUD-методы), `extension/content.js`
  (`resolveDriverContext` + свитчер), `extension/popup.html`, `extension/popup.js`
  (секция «Парк»), `extension/manifest.json` (подключить `drivers.js`)
- **edit** `CLAUDE.md` (модуль drivers + аноним-фолбэк в конвенциях)
