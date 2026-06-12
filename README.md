# LoadLens

SaaS Chrome-расширение поверх **DAT One** и **Truckstop**: помогает диспетчерам находить выгодные
грузы и не давать водителю простаивать.

Три слоя ценности:

1. **Скоринг выгодности** каждого груза — $/милю с учётом deadhead, топлива и медианы рынка по lane
   (два бейджа на строку: выгодность + HOS-выполнимость).
2. **HOS-бейдж** — успеет ли водитель легально (11h/14h/30min/70h-8d), движок правил из
   `hos-calculator`. Этого не делает ни один борд.
3. **«Get-out» планировщик цепочек** (hero) — подбирает 2–3 груза вперёд по силе рынка назначения,
   чтобы выехать из «мёртвых» рынков; берёт даже не очень выгодный груз ради дороги в сильный рынок.

Архитектура повторяет [PriceLens](../999): расширение MV3 (парсинг DOM залогиненной сессии,
бейджи + панель, `chrome.storage`) + NestJS/Sequelize/Postgres бэкенд (крауд-база ставок по lane,
JWT-аккаунты, Pro-план).

**Живой дашборд:** [loadlens.krait.studio](https://loadlens.krait.studio) — статистика по lane'ам
(медиана RPM, объём, коридор p25–p75), наполняется по мере работы расширения. API: `/api/v1`.

## Структура

| Каталог | Что |
|---|---|
| `extension/` | MV3-расширение: `adapters/` (DAT/Truckstop), `content.js`, `api.js`, `geo.js`, `hos.js`, `popup`, `vendor/` (копии shared) |
| `backend/` | NestJS: `loads` (ingest), `lanes` (median RPM), `markets` (strength), `geo` (OSRM+кэш), `rates` (EIA), `auth` |
| `shared/` | Канонические `load.model.js`, `scoring.js`, `planner.js`, `markets.seed.json`, `hos-calculator.js` |

## Разработка

```bash
# тесты (shared + extension)
npm test

# бэкенд
cd backend
docker compose -p loadlens up -d        # Postgres на :5435
cp .env.example .env                     # задать JWT_SECRET
npm install && npm run build && npm test
DATABASE_URL=postgresql://loadlens:loadlens@localhost:5435/loadlens JWT_SECRET=dev node dist/main.js

# расширение: chrome://extensions → Режим разработчика → Загрузить распакованное → extension/
# при правке shared/*.js пересобрать vendor:
npm run sync:shared
```

## Статус

MVP. DOM-селекторы бордов — **заглушки** (`extension/adapters/*_SELECTORS`): снять с живой
залогиненной сессии перед использованием. Подробности и юр-ограничения (ToS DAT/Truckstop,
не перепродаём rate-данные, PII режется на клиенте) — в плане и `CLAUDE.md` workspace.
