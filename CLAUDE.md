# CLAUDE.md — LoadLens

Контекст проекта для Claude Code. Прочитай перед работой.

## Что это

**LoadLens** — SaaS Chrome-расширение поверх load boards **DAT One** и **Truckstop**: помогает
диспетчерам находить выгодные грузы и не давать водителю простаивать. Архитектура повторяет
PriceLens (`../999`): расширение MV3 (парсинг DOM залогиненной сессии → бейджи + панель) + бэкенд
NestJS/Sequelize/Postgres (крауд-база ставок по lane, JWT-аккаунты, Pro). Freemium.

Три слоя ценности (первый — table stakes, остальные два — moat, см. исследование в плане):
1. **Скоринг выгодности** груза: true $/милю с учётом deadhead, топлива и медианы рынка по lane.
2. **HOS-бейдж** — успеет ли водитель легально (11h/14h/30min/70h-8d). Движок — `shared/hos-calculator.js`.
3. **«Get-out» планировщик цепочек** (hero) — 2–3 груза вперёд по силе рынка назначения, чтобы
   выехать из «мёртвых» рынков (берёт даже невыгодный груз ради дороги в сильный рынок).
   Onward-плечи берутся из крауд-базы (`GET /loads?origin=<destMarket>`), а не из текущей выдачи —
   поэтому цепочки многоплечевые даже когда видна одна выдача из одного рынка. Своих вызовов к DAT нет.

## Структура

```
extension/                  MV3-расширение (грузит vendor/* → api → adapters → geo/hos → content)
  inject.js                 ★ MAIN-world перехватчик: патчит fetch/XHR, ловит ответы DAT FindLoads
                            (one-web-bff/graphql), шлёт их content.js через postMessage. Своих запросов к DAT НЕ шлём.
  adapters/
    dat.graphql.js (DAT_GQL) ОСНОВНОЙ путь DAT: parseFindLoads(json)→Load[] по реальной GraphQL-схеме
                            (FreightSearchV4FindLoadsResult). Богатые поля: rate+basis, trip/DH miles,
                            equipmentType, brokerMc, creditScore, daysToPay (broker-trust). Фикстура — синтетика.
    dat.adapter.js          DOM-адаптер DAT (fallback / построчные бейджи); *_SELECTORS — ★ ЗАГЛУШКИ
    truckstop.adapter.js    DOM-адаптер Truckstop; *_SELECTORS — ★ ЗАГЛУШКИ
    adapters.js             реестр adapterFor(host); __fixtures__/ — фикстуры для тестов
  content.js                источник: gqlLoads (перехват, приоритет) → панель/скоринг/sync; DOM → построчные бейджи
  api.js (LLAPI)            JWT-клиент + sanitizeLoad (PII-фильтр) + sendLoads/getLane/getMarket/getDistance
  geo.js, hos.js            обёртки: дистанции (backend+haversine), HOS-состояние водителя
  drivers.js (LLDRV)        парк диспетчера: resolveDriverContext (чистая, выбор контекста планировщика) + per-device активный водитель (ll_active_driver)
  alerts.js (LLALERT)       релей green+passEquip грузов в Telegram: keyFor/toPayload (без PII) + push (гейт linked/enabled, session-дедуп). Вызывается из content.render
  popup.*                   настройки водителя (cost/mile, HOS-часы) + аккаунт + секция «Парк» (CRUD водителей) + секция «Telegram-уведомления» (Pro)
  vendor/                   ★ АВТОКОПИИ из shared/ (load.model, scoring, planner, markets.seed). `npm run sync:shared`
backend/src/                NestJS, synchronize:true (миграций нет)
  loads/                    POST /loads — ingest+upsert; GET /loads?origin=&equipment= — крауд-грузы рынка (onward-плечи цепочек, без PII)
  lanes/                    GET /lanes/:o/:d — median RPM по lane (чистый SQL-агрегат)
  markets/                  GET /markets/:m/strength — сила рынка (крауд-плотность + seed-фолбэк)
  geo/                      GET /geo/distance — OSRM-прокси + кэш lane_distances + haversine
  brokers/                  POST /brokers/reports (crowd-отзыв, upsert client_id+mc) + GET /brokers/:mc/reputation
  drivers/                  GET/POST/PATCH/DELETE /drivers — парк водителей диспетчера (JwtAuthGuard, скоуп userId, каскад от users)
  telegram/                 link/status/unlink/alerts (Jwt[+Pro]) + notify (релей green-грузов→Telegram DM) + webhook/:secret (/start привязка chat_id). alert_sends — дедуп(TTL)+soft-cap. Фича-флаг = TELEGRAM_BOT_TOKEN
  rates/                    GET /rates — дизель EIA (фолбэк $3.95 без EIA_API_KEY)
  auth/ users/              register/login/refresh/me, DELETE /users/me (hard-delete + каскад водителей), PATCH /admin/users/:email/plan
  shared/markets.seed.json  ★ копия seed для Docker-контекста backend/ (генерит sync:shared)
shared/                     КАНОН: load.model.js, scoring.js, planner.js, markets.seed.json, hos-calculator.js
```

★ = требует внимания при правках (см. конвенции).

## Команды

```bash
npm test                 # sync:shared + тесты shared (17) + extension (10)
npm run sync:shared      # пересобрать extension/vendor/* и backend/shared/* из shared/ — ПОСЛЕ любой правки shared/*.js
cd backend && docker compose -p loadlens up -d && cp .env.example .env && npm install && npm run build && npm test
# расширение: chrome://extensions → Загрузить распакованное → extension/
```

## Конвенции (важное)

- **shared/ — единственный источник правды** для `load.model`/`scoring`/`planner`/`markets.seed`.
  После правки — `npm run sync:shared` (иначе расширение и backend разойдутся). vendor/ и
  backend/shared/ — автокопии, руками не редактировать.
- **Два источника данных DAT.** (1) ОСНОВНОЙ — перехват собственных GraphQL-ответов приложения DAT
  (`inject.js` → `DAT_GQL.parseFindLoads`): надёжно, не зависит от вёрстки, поля точные. (2) Fallback —
  DOM-парсинг (`dat.adapter.js`, селекторы-заглушки). Для Truckstop пока только DOM-путь.
  При смене GraphQL-схемы DAT — обновить `DAT_GQL` + фикстуру `__fixtures__/dat-findloads.json`.
- **DOM-якоря бейджей.** DAT — РЕАЛЬНЫЕ: строка `div.row-container[id^="table-row-<rowKey>"]`.
  **Важно (с ~2026-06-17): `result.resultId` из FindLoads стал КОМПОЗИТНЫМ** — `<длинное>+<rowKey>`,
  а DOM-id строки = только хвост после последнего `+`. Поэтому матчить строку↔груз нужно по
  `dat.adapter.domRowKey(resultId)` (= `resultId.split('+').pop()`, обратносовместимо со старым
  форматом без `+`), а НЕ по полному `resultId`. Это используют и `anchor(loads)` (бейджи), и
  `scrollToRow(resultId)` (прокрутка к строке из Get-out плеча). Регрессия «полного resultId» молча
  ломает СРАЗУ И бейджи, И прокрутку — см. тест `adapters.test.js`. Truckstop — `*_SELECTORS` всё ещё
  ЗАГЛУШКИ, снять с живой сессии.
- **ToS/PII — критично.** **Мы НЕ инициируем запросов к API DAT** — `inject.js` только наблюдает
  ответы, которые приложение DAT уже загрузило в сессии пользователя (как DOM-overlay у LoadConnect/
  LoadHunter; это и есть граница «читаем то, что пользователь видит»). Автоматический вызов их
  GraphQL/REST с сессионным токеном — путь Convoy, делать НЕЛЬЗЯ без Integrations-партнёрства.
  Наружу через наш API — только агрегат (median по lane), не дамп. PII (email/phone/контакты) режется
  в `LLAPI.sanitizeLoad` ДО отправки; `brokerMc`/`creditScore`/`daysToPay` — бизнес-данные, не PII.
  **Живые DAT-токены в чат/файлы не вставлять и не использовать для скрейпинга.** Прецедент DAT v. Convoy.
- **HOS-правила** (11h/14h/30min/70h-8d, split sleeper) живут в `shared/hos-calculator.js` +
  упрощённая мультисменная forward-модель в `planner.stepHos`. Обязательный сон не штрафует ранг.
- **Broker-trust бейдж** (`LLSCORE.brokerBadge`): good/ok/risk по `creditScore` (≥90 good, <75 risk)
  + `daysToPay` (≤30 ok, >40 risk). Данные из GraphQL-перехвата DAT (CS/DTP). Третий чип в полосе
  под строкой. Это carrier-сторона фрод-защиты (дифференциатор из исследования).
- **Crowd-репутация брокеров** (`backend/brokers`): отзывы пользователей по MC (paid/no_issue/slow/
  flaked/double_brokered), upsert по `client_id+mc` (один вердикт на юзера → нет накрутки), агрегат
  `deriveLevel` → good/mixed/bad/thin. Чётвертый (clickable) чип в полосе + меню отзыва. MC нормализуем
  к цифрам (`normalizeMc`). Поверх DAT-кредита — это network-effect moat.
- **Парк водителей** (`backend/drivers` + `extension/drivers.js`): диспетчер ведёт несколько
  водителей (имя/рынок/HOS/equipment/costPerMile/homeBase/status), профили на бэкенде под JWT
  (скоуп `userId`, каскад от users). **Гейт Pro** (`drivers/pro.guard.ts` — `JwtAuthGuard, ProGuard`):
  парк только для `plan==='pro'`; Free → 403 → пустой парк → аноним-режим. Активный водитель —
  per-device (`ll_active_driver`) — питает скоринг и цепочки через `LLDRV.resolveDriverContext`.
  **Без логина / Free / пустой парк — аноним-режим: прежнее поведение (`ll_hos`, `topOriginMarket`).**
  Свитчер водителя — в шапке панели, CRUD парка — в popup. `homeBase` хранится, в скоринг не идёт (YAGNI).
- **Матчинг «все водители сразу»** (`shared/fleet.js` `LLFLEET.matchLoadToFleet`): на каждом грузе
  чип `👤 лучший (N/M)` (переиспользует `LLPLAN.stepHos` + `LLSCORE.netRpm`): equipment-фильтр +
  deadhead от локации водителя + HOS-гейт + netRpm → ранжирование; `status:'off'` исключаются.
  Клик → разбивка «Кому подходит» в карточке детали. Считается локально (данные грузов на сервер не шлём).
- **Telegram-алерты** (`backend/telegram` + `extension/alerts.js` + popup-секция): пока DAT-вкладка
  открыта, `content.render` отдаёт `LLALERT.push` грузы **green+passEquip** (те же, что «Выгодные сейчас»);
  тот шлёт их в `POST /telegram/notify` → бот DM-ит диспетчеру. **Гейт Pro** + привязка Telegram
  (`/telegram/link` → deep-link `t.me/<bot>?start=<token>` → вебхук `/telegram/webhook/:secret` ловит
  `/start` и пишет `users.telegram_chat_id`) + тумблер `alerts_enabled`. Дедуп **по семантическому
  ключу** (`board|origin>dest|equip|rate|miles|mc`, НЕ по композитному resultId) + TTL 6ч + soft-cap
  10/10мин (`alert_sends`). **ToS/PII:** только грузы из сессии пользователя, наружу — lane/$/мили/RPM/
  brokerMC+кредит, контакты режутся. Фича-флаг = `TELEGRAM_BOT_TOKEN` (нет токена → молчит, как EIA).
- **Скоринг:** trueRpm = rate/(loaded+deadhead); бейдж: **red** = netRpm < break-even (cost/mile,
  дефолт $1.80, нижняя граница убытка); **green** = trueRpm ≥ целевой $/mi бакета дистанции
  (`LLSCORE.targetForMiles` по таблице `DEFAULTS.targets`: ≤500mi→$7, ≤1000→$6, 1000+→$5; конфиг
  в попапе `ll_targets`); **amber** между. Цель задаётся per-груз по его `loadedMiles` и имеет
  приоритет над медианой lane (медиана остаётся фолбэком green, когда `targetRpm` не передан, и
  показывается как «рынок $X»). Ручной фильтр прицепа `ll_equip_filter` прячет грузы в панели.
  `metric` груза = RPM (аналог цены в PriceLens).
- Backend: `synchronize:true` (миграций нет, MVP). Новые колонки — идемпотентный
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` в `main.ts`, т.к. synchronize не меняет существующие таблицы.

## Деплой (Coolify, self-hosted 46.4.25.36)

Развёрнуто: **https://loadlens.krait.studio** (API на `/api/v1`, дашборд на `/`, health `/healthz`).
Деплой/логи/env — по скиллу `coolify-deploy`, **всегда** `--context yoolip999`. Репозиторий приватный
`bogbuk/loadlens`, **автодеплой: push в `main` → сборка+деплой**.

| что | значение |
|---|---|
| context | `yoolip999` (сервер 46.4.25.36:8000) |
| project | LoadLens — `ocls09doyppd1f5ze0fsjj8r` (env production `cmkw3wlejtmfiza7j2d7nauh`) |
| app | loadlens-backend — `hiooby9kgzj8i79ycl33drec` (base dir `/backend`, dockerfile, порт 3000, healthcheck off) |
| db (Postgres) | loadlens-db — `saf6kfw7p9r1nmmc4475g6cn` (хост в Docker-сети = этот uuid) |
| server | localhost — `f8xhhqagybtdjk14krvrp0kq`; destination `coolify`/`p8db7h90y6pwun2gri2rjwke` |
| github app | bogbuk-github-1 — `lwn318orbfd7rrv82xrkup75` |
| домен | `loadlens.krait.studio` (Cloudflare proxied, SSL Full) |

```bash
coolify --context yoolip999 app logs hiooby9kgzj8i79ycl33drec            # runtime-логи
coolify --context yoolip999 app deployments list hiooby9kgzj8i79ycl33drec
# деплой: токен yoolip999 НЕ имеет права `deploy` (403) → деплоить ПУШЕМ в main (автодеплой)
# env (новый деплой подхватывает только свежий): app env sync <uuid> --file .env --is-literal ; затем push
```

Env в Coolify: `DATABASE_URL`, `JWT_SECRET`, `ADMIN_KEY`, `PORT`. Опц. `EIA_API_KEY` (без него дизель =
фолбэк $3.95), `OSRM_URL` (дефолт публичный OSRM). Для Telegram-алертов: `TELEGRAM_BOT_TOKEN` +
`TELEGRAM_BOT_USERNAME` (deep-link) + `TELEGRAM_WEBHOOK_SECRET` (без них фича выключена). После деплоя
один раз зарегистрировать вебхук: `setWebhook` на `https://loadlens.krait.studio/api/v1/telegram/webhook/<secret>`.

> **Грабли деплоя (решено):** `npm ci` требует `package-lock.json`, а унаследованный `.gitignore` его
> игнорировал → сборка падала за 12с с `EUSAGE`. Фикс: `!backend/package-lock.json` + коммит лока.
> Build-логи failed-деплоя Coolify отдаёт ТОЛЬКО в веб-UI (не в CLI/REST) — для диагностики сборки
> сразу открывать страницу деплоя в UI.

## Партнёрство с бордами (два трека)

Чтобы уйти от правового риска DOM-парсинга (DAT ToS §1.2 запрещает browser extension для извлечения
Product Data; прецедент DAT v. Convoy) — два независимых трека партнёрства с DAT (аналогично Truckstop):

1. **Solutions Integrations Partner (приоритет, про данные).** Официальный доступ к DAT Developer
   Portal (API: Load Board, RateView, BookNow). Это легальный источник грузов/ставок вместо парсинга:
   добавляется `LLADAPT`-совместимый «API-адаптер», отдающий тот же unified `Load`; DOM-адаптеры
   остаются как fallback для пользователей без API-доступа. Минусы: setup fee (~$500–1000),
   сертификация, обычно требует активной подписки DAT у конечного пользователя. Truckstop-аналог —
   Marketplace partner program (там уже LoadHunter — прецедент приёма надстроек).
2. **Affiliate Program (вторично, про деньги).** Реферальная комиссия за привод клиентов в DAT
   (Load Board / Factoring). НЕ даёт доступа к API/данным. Для LoadLens — побочный канал: расширение
   работает только поверх залогиненной сессии DAT → каждый пользователь = активный подписчик DAT,
   так что нарратив «помогаем подписчикам извлечь больше из подписки + приводим новых» honest.
   Подавать как `Carrier`, программа `Load Board Affiliate`. На pre-launch цифры клиентов не завышать
   (DAT сверяет mutual customers).

Архитектура от этого не меняется: слой site-adapters (`extension/adapters/`) остаётся ядром, API-адаптер
— это просто второй источник того же `Load`. Crowdsourced-база ставок строится только на данных,
видимых пользователю в его сессии (это и для ToS чисто, и для affiliate-нарратива удобно).

## Домен (FMCSA / freight)

- **HOS:** 11h driving, 14h on-duty window, 30min break, 70h/8d или 60h/7d, split sleeper.
- **Equipment-коды:** V=Van, R=Reefer, F=Flatbed, SD=Step Deck, PO=Power Only.
- **Бенчмарки RPM** (калибровка скоринга): ATRI 2024 all-in $2.26/mi, non-fuel $1.78; owner-op true CPM $1.45–1.95.
- **Market key:** `CITY_ST` (напр. `CHICAGO_IL`); lane groupKey = `board|origin>dest|equipment`.
