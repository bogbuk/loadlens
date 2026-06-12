# Task: LoadLens MVP — расширение + бэкенд для поиска выгодных грузов на DAT/Truckstop
Date: 2026-06-12
Status: done

## Checklist
- [x] Скелет репо: root package.json, shared/, копия hos-calculator
- [x] shared/load.model.js (unified Load + нормализаторы)
- [x] shared/scoring.js (RPM/profit/бейджи — чистые функции)
- [x] shared/markets.seed.json (cold-start рынки)
- [x] shared/planner.js (beam search цепочек + HOS-гейт, мультисменная модель)
- [x] Backend: форк каркаса (auth/users/health/main/app.module)
- [x] Backend модуль loads (ingest + upsert по board+load_id)
- [x] Backend модуль lanes (median RPM по lane)
- [x] Backend модуль markets (strength + seed)
- [x] Backend модуль geo (OSRM-proxy + кэш lane_distances + haversine)
- [x] Backend модуль rates (EIA diesel)
- [x] Extension: manifest.json (оба борда)
- [x] Extension: api.js (LLAPI)
- [x] Extension: adapters (dat + truckstop + registry) + фикстуры
- [x] Extension: geo.js, hos.js (обёртки над shared)
- [x] Extension: content.js (форк — adapter вместо category) + бейджи + панель
- [x] Extension: popup, styles, vendor-sync
- [x] Тесты: adapter.test, planner.test, scoring.test, load.model.test, backend *.spec

### Verification
- [x] build (backend nest build → dist/main.js)
- [x] unit-тесты зелёные (shared 17, ext 10, backend 21)
- [x] e2e-smoke: ingest→lane median $2.90, market seed, geo OSRM 684mi, rates, JWT register
- [ ] commit & push (ожидает подтверждения пользователя)

## Деплой (готово, кроме DNS)
- [x] Coolify: project LoadLens + Postgres loadlens-db + app loadlens-backend, автодеплой по push в `main`.
- [x] Сборка зелёная, контейнер running, `Nest application successfully started`, БД подключена.
- [x] Проверено через Traefik (Host-заголовок): `/healthz` ok, `/markets`, `/rates` отвечают.
- [ ] **Cloudflare DNS** `loadlens.krait.studio` A → `46.4.25.36` (proxied, SSL Full) — только так
      домен станет публично доступен (Traefik-маршрут уже зарегистрирован). Делает владелец Cloudflare.
- Координаты деплоя — в памяти проекта `loadlens-coolify-deploy`.

## Открытые задачи перед продакшеном
- Снять реальные DOM-селекторы DAT One / Truckstop с живой залогиненной сессии,
  обновить `extension/adapters/*_SELECTORS` и фикстуры в `__fixtures__/`.
- Заявки в DAT Developer Portal / Truckstop Marketplace (легальный путь).
