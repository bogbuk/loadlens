# Spec: Парк водителей + per-driver HOS + fleet-матчинг груз↔водитель

Date: 2026-06-14
Status: approved (design)

## Контекст и цель

Сейчас LoadLens — один аккаунт = один водитель: HOS-состояние единственное, хранится в
`chrome.storage` (`ll_hos`), вводится вручную в попапе. Скоринг/HOS-бейдж/планировщик считаются
для этого одного водителя.

Продукт нацелен на **200+ диспетчеров (тенантов), у каждого свой парк водителей**. Нужно:
дать диспетчеру вести парк, у каждого водителя — свой HOS, и показывать на каждом грузе,
**кому из парка он подходит** (HOS-выполним, по прицепу, выгоден). Это превращает LoadLens из
«калькулятора для одного» в **диспетчерский матчер груз↔водитель**.

Решения (подтверждены с пользователем):
- Хранение: **сервер, мультитенант** (водители+HOS привязаны к аккаунту).
- Ввод HOS: **ручной** (остаток drive/duty/cycle на водителя). ELD — фаза 2.
- Матчинг: **все водители сразу** (для каждого груза — кто подходит).
- Карточка водителя: **имя + локация (рынок) + прицеп + HOS**.
- UI матчинга: **бейдж на грузе с лучшим водителем + (N/M)**, клик → разбивка.
- **Гейт Pro:** парк и fleet-матчинг — Pro-фича; Free остаётся на одном ручном HOS.

## Архитектура (вариант A: парк на сервере + матчинг на клиенте)

Водители/HOS — на бэкенде (изоляция по аккаунту через JWT). Расширение тянет парк и считает
матчинг **локально** чистой функцией (переиспользует `LLPLAN.stepHos` + `LLSCORE`). Данные грузов
на сервер для матчинга НЕ уходят (приватность/ToS — как сейчас). Это сохраняет границу «читаем то,
что пользователь видит» и не шлёт PII.

## Бэкенд — модуль `backend/src/drivers`

Сущность `Driver` (sequelize-typescript, `synchronize:true`):
- `id` UUID PK
- `userId` UUID, FK→users, **NOT NULL** (владелец = тенант), index
- `name` TEXT
- `market` TEXT (текущий рынок, нормализ. ключ `CITY_ST`, напр. `CHICAGO_IL`); nullable
- `equipment` TEXT (V/R/F/SD/PO…)
- `remainingDriveMin` INT (дефолт 660), `remainingDutyMin` INT (840), `remainingCycleMin` INT (4200)
- `hosUpdatedAt` DATE (когда водитель последний раз обновил часы)
- `createdAt`/`updatedAt`

Эндпоинты под `JwtAuthGuard` (Bearer access-токен), **каждый запрос строго фильтруется по
`userId` из JWT-пейлоада (`sub`)** — критично для изоляции 200+ тенантов:
- `GET /api/v1/drivers` → список водителей аккаунта
- `POST /api/v1/drivers` `{name, market?, equipment, driveH?, dutyH?, cycleH?}` → создать
- `PATCH /api/v1/drivers/:id` → обновить (локация/прицеп/часы); 404 если водитель не принадлежит `userId`
- `DELETE /api/v1/drivers/:id` → удалить (с проверкой владельца)

DTO-валидация (`class-validator`): `name` ≤80, `equipment` `@IsIn` коды, `market` `@Matches` `CITY_ST`,
часы — `@IsNumber` 0..70 (конвертируются в минуты в сервисе). `ValidationPipe whitelist`.

**Изоляция тенанта** — единый паттерн: сервис принимает `userId` (из контроллера, из `req.user.sub`),
все запросы `where: { userId, ... }`. Никаких операций без `userId`. Хелпер `@CurrentUserId()`
декоратор или чтение `req.user.sub` в контроллере (JwtAuthGuard уже кладёт пейлоад в `req.user`).

**Гейт Pro:** запись/чтение парка разрешены только `plan==='pro'`. Проверка плана в сервисе/гарде
(подтянуть user по `sub`, проверить `plan`). Free → 402/403 с понятным сообщением; расширение
показывает «парк доступен в Pro».

## Матчинг — чистая функция `shared/fleet.js` (`LLFLEET`)

```
matchLoadToFleet(load, drivers, ctx) -> ranked: [{
  driverId, name, equipMatch, deadhead, hosBadge, netRpm, feasible
}]
```
ctx = `{ distance(aMarket,bMarket), dieselPrice, costPerMile }`.
Для каждого водителя:
- `equipMatch` = `driver.equipment === load.equipment` (точное совпадение кода);
- `deadhead` = `driver.market ? round(distance(driver.market, load.originMarket)) : (load.deadheadMiles||0)`;
- `driveMin` = `LLPLAN.legMinutes(load.loadedMiles + deadhead)`; `hos` = `LLPLAN.stepHos(driverHos, driveMin, 120)`;
- `hosBadge` = hos.feasible ? hos.badge : 'red';
- `netRpm` = `LLSCORE.netRpm({...load, deadheadMiles: deadhead}, {dieselPrice, costPerMile})`;
- `feasible` = `equipMatch && hos.feasible`.
Сортировка: feasible-первыми, затем по `netRpm` убыв. **Лучший водитель** = `ranked[0]` если feasible.
`feasibleCount` = число feasible; `total` = drivers.length.

Чистая, без сети/DOM → юнит-тест синтетикой.

## Расширение

- **api.js (LLAPI):** `getDrivers()`, `createDriver(d)`, `updateDriver(id,d)`, `deleteDriver(id)`
  (Bearer access-токен + авто-refresh, как `getMe`). Кэш парка в памяти + `chrome.storage`
  (офлайн-грейс), TTL ~ как план.
- **content.js:** на старте (если Pro и залогинен) тянет парк; для каждого видимого груза зовёт
  `LLFLEET.matchLoadToFleet(load, fleet, {distance: LLGEO.sync, dieselPrice, costPerMile})`.
  - **Бейдж на грузе** (в полосе): чип `👤 {bestName} ({feasibleCount}/{total})`, цвет по HOS+выгодности
    лучшего; если никто не подходит — серый `👤 нет (0/{total})`. Клик → разбивка в карточке детали:
    список водителей с HOS-бейджем, deadhead, $/mi, причиной отказа (прицеп/часы).
  - Если парк пуст или Free → бейдж водителя не показываем, поведение как сейчас (единичный HOS из попапа
    остаётся фолбэком для Free).
- **Карточка детали:** новая секция «Кому подходит» — `matchLoadToFleet` разбивка.
- **Get-out планировщик:** прогон `LLPLAN.plan` по каждому водителю из его `market` с его HOS; топ-цепочки
  по парку, каждая подписана водителем. Бюджет компьюта ограничен (малый парк).
- **Попап — менеджер парка** (заменяет единичный HOS-ввод при Pro): список водителей, добавить/удалить,
  на каждого инлайн-поля имя/рынок/прицеп/drive/duty/cycle → `createDriver`/`updateDriver`. Free видит
  старый единичный HOS-ввод + предложение Pro.

## Что меняется в существующем

- `extension/hos.js` (`LLHOS`): остаётся для Free (единичный HOS). Для Pro источник HOS — выбранный
  водитель из парка.
- `content.js`: бейджи теперь учитывают парк (через `LLFLEET`); если парка нет — текущее поведение.
- Попап: секция настроек водителя → менеджер парка (Pro) / единичный HOS (Free).

## Фазы

**MVP (этот спек):** модуль `drivers` (CRUD + изоляция + Pro-гейт), `shared/fleet.js` матчер,
бейдж лучшего водителя + разбивка, менеджер парка в попапе, fleet-aware get-out планировщик.

**Фаза 2 (вне спека):** ELD-интеграция (Motive/Samsara) — авто-HOS вместо ручного; home-base /
home-time планирование; назначение груза водителю (book + worklist).

## Тесты

- `shared/fleet.test.js`: equipment-фильтр; HOS-гейт отбрасывает; ранжирование по netRpm;
  deadhead от локации водителя; «никто не подходит»; пустой парк.
- `backend/src/drivers/drivers.service.spec.ts`: CRUD; **изоляция — нельзя получить/изменить чужого
  водителя (другой userId → 404)**; Pro-гейт.
- e2e на проде: register Pro → CRUD водителей → проверка, что чужой аккаунт их не видит.

## Критичные файлы

- НОВОЕ: `backend/src/drivers/` (model/dto/service/controller/module + spec), `shared/fleet.js` (+ test).
- Правки: `backend/src/app.module.ts` (Driver model + DriversModule), `extension/api.js` (+driver-методы),
  `extension/content.js` (fleet-бейдж + разбивка), `extension/popup.{html,js}` (менеджер парка),
  `extension/manifest.json` (vendor fleet.js), `scripts/sync-shared.js` (fleet.js → vendor).
