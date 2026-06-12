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

## Структура

```
extension/                  MV3-расширение (грузит vendor/* → api → adapters → geo/hos → content)
  adapters/                 site-adapters: dat.adapter.js, truckstop.adapter.js (+ adapters.js реестр)
    *_SELECTORS             ★ DOM-селекторы — ЗАГЛУШКИ. Снять с живой залогиненной сессии,
    __fixtures__/           обновить + фикстуры для adapters.test.js
  content.js                MutationObserver → parseRow → 2 бейджа на строку → панель цепочек → server-sync
  api.js (LLAPI)            JWT-клиент + sanitizeLoad (PII-фильтр) + sendLoads/getLane/getMarket/getDistance
  geo.js, hos.js            обёртки: дистанции (backend+haversine), HOS-состояние водителя
  popup.*                   настройки водителя (cost/mile, HOS-часы) + аккаунт
  vendor/                   ★ АВТОКОПИИ из shared/ (load.model, scoring, planner, markets.seed). `npm run sync:shared`
backend/src/                NestJS, synchronize:true (миграций нет)
  loads/                    POST /loads — ingest+upsert по (board, load_id)
  lanes/                    GET /lanes/:o/:d — median RPM по lane (чистый SQL-агрегат)
  markets/                  GET /markets/:m/strength — сила рынка (крауд-плотность + seed-фолбэк)
  geo/                      GET /geo/distance — OSRM-прокси + кэш lane_distances + haversine
  rates/                    GET /rates — дизель EIA (фолбэк $3.95 без EIA_API_KEY)
  auth/ users/              register/login/refresh/me, PATCH /admin/users/:email/plan (X-Admin-Key)
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
- **DOM-селекторы бордов — заглушки** в `*_SELECTORS`. Реальные снять с живой залогиненной сессии
  DAT One/Truckstop через DevTools, обновить селекторы + HTML-фикстуры. Логика parseRow от
  селекторов отвязана — меняется только карта.
- **ToS/PII:** не персистим/не перепродаём rate-данные DAT/Truckstop «как есть» — наружу только
  агрегат (median по lane). PII (контакты/телефоны/имена) режется в `LLAPI.sanitizeLoad` ДО отправки;
  whitelist полей Load — явный список. Прецедент DAT v. Convoy.
- **HOS-правила** (11h/14h/30min/70h-8d, split sleeper) живут в `shared/hos-calculator.js` +
  упрощённая мультисменная forward-модель в `planner.stepHos`. Обязательный сон не штрафует ранг.
- **Скоринг:** trueRpm = rate/(loaded+deadhead); бейдж red/amber/green по break-even (cost/mile,
  дефолт $1.80) и медиане lane. `metric` груза = RPM (аналог цены в PriceLens).
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
фолбэк $3.95), `OSRM_URL` (дефолт публичный OSRM).

> **Грабли деплоя (решено):** `npm ci` требует `package-lock.json`, а унаследованный `.gitignore` его
> игнорировал → сборка падала за 12с с `EUSAGE`. Фикс: `!backend/package-lock.json` + коммит лока.
> Build-логи failed-деплоя Coolify отдаёт ТОЛЬКО в веб-UI (не в CLI/REST) — для диагностики сборки
> сразу открывать страницу деплоя в UI.

## Домен (FMCSA / freight)

- **HOS:** 11h driving, 14h on-duty window, 30min break, 70h/8d или 60h/7d, split sleeper.
- **Equipment-коды:** V=Van, R=Reefer, F=Flatbed, SD=Step Deck, PO=Power Only.
- **Бенчмарки RPM** (калибровка скоринга): ATRI 2024 all-in $2.26/mi, non-fuel $1.78; owner-op true CPM $1.45–1.95.
- **Market key:** `CITY_ST` (напр. `CHICAGO_IL`); lane groupKey = `board|origin>dest|equipment`.
