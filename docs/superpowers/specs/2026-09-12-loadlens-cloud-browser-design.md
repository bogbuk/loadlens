# LoadLens Cloud — браузер в облаке как единственное рабочее место DAT

Дата: 2026-09-12. Статус: дизайн утверждён, **реализация заблокирована до ответов спайка** (вопросы 2 и 3, см. §8).

## 1. Цель и границы

Pro-пользователь включает «Cloud» и получает свой Chromium с DAT One и LoadLens на нашем сервере в США,
работающий 24/7: авто-пилот обновляет выдачу, движок правил шлёт Telegram-алерты, пользователь заходит
на экран по ссылке только чтобы залогиниться, поменять поиск или позвонить брокеру.

**Ключевое ограничение (проверено спайком 2026-09-12):** DAT One держит **одну активную сессию на
аккаунт**. Логин в облаке и на ноутбуке одновременно невозможен: второй логин вытесняет первый.
Поэтому продукт — **облако как единственное рабочее место DAT**, а не «алерты в фоне, пока я работаю
в DAT локально». Целевая аудитория: owner-operators и малые парки, которые заходят в DAT редко
(лид из Fontana: «компьютер дома 24/7, заходить раз в 1–2 дня»). Диспетчерам, живущим в DAT весь день,
продукт не подходит — это пишется прямо на лендинге и в попапе.

Отброшенные варианты: второй DAT-seat под облако (решение клиента, не наше), ночной режим с ежедневным
релогином, headless-воркер с хранением паролей (путь Convoy), managed-браузеры (Browserbase: дорого для
24/7, IP-пулы в бан-листах), резидентные прокси (осознанный обход антибота), neko/Kasm (лишний слой).

## 2. Архитектура

```
popup «Cloud» ──JWT──▶ backend /cloud/* ──dockerode mTLS──▶ US-сервер (Ashburn)
                          │                                  ├─ Caddy  /screen/<token> ─▶ ll-<userId>:6080 (noVNC)
                          │                                  └─ контейнер ll-<userId>:
                          │                                       Xvfb + x11vnc + websockify + Chromium(--load-extension)
                          ▼                                       volume ll-profile-<userId> (DAT-сессия)
                    Telegram DM ◀── watchdog (@Cron 5 мин)  ◀── heartbeat из расширения (cloud mode)
```

Компоненты:
- **Образ `cloud-browser/`** — Chromium/Chrome + Xvfb + x11vnc + noVNC + распакованное расширение
  (`extension/` из того же коммита). Спайк `cloud-browser/spike/` — заготовка. Прод: seccomp-профиль с
  разрешённым `clone(CLONE_NEWUSER)` вместо `--no-sandbox`; на x86 `google-chrome-stable`.
  Managed-policy файл расширения задаёт `ll_cloud_mode: true`.
- **Оркестратор** `backend/src/cloud/` — таблица `cloud_instances`, Docker-клиент, экран по ссылке,
  watchdog.
- **Cloud mode в расширении** — `extension/cloud.js` (`LLCLOUD`): форс авто-пилота, heartbeat, детект
  вытеснения.
- **Экран по ссылке** — Caddy на US-сервере, одноразовые токены 15 мин, noVNC наружу не торчит.

Один контейнер на пользователя, один сервер, никакого автоскейла (YAGNI). Coolify не используется:
он не умеет «контейнер на тенанта по API».

## 3. Инфраструктура и деньги

- **Сервер:** Hetzner Cloud CPX41 (8 vCPU/16 GB, ~€30/мес) в Ashburn на первых ~8 тенантов; при росте
  dedicated AX42 (~€50/мес, ~30 тенантов). Docker Engine API на 2376 по mTLS, доступ только с IP бэкенда.
- **Ресурсы на тенанта** (замер спайка, выдача 2849 грузов): RAM ~1.2 GB, CPU ~0.35 ядра. Лимиты
  контейнера: `mem 2g`, `cpus 1`, `shm 512m`. Себестоимость €2–4/тенант/мес.
- **Один IP на всех тенантов** — главный инфраструктурный риск (§7). Не более ~10 DAT-аккаунтов на IP,
  дальше докупать адреса и раскидывать контейнеры через `--ip`.
- **Хранение:** named volume на тенанта (~300 MB) с DAT-сессией. Диск шифрован, бэкапов volume нет,
  удаление через 30 дней после Disable.
- **Тариф (предварительно, решение владельца):** план «Pro Cloud» $59/мес, включает Pro. Stripe нет —
  включает админ (`cloud_enabled`). Лид из Fontana: $59/мес + $149 разово за настройку.

## 4. Расширение

- **`ll_cloud_mode`** читается из `chrome.storage.managed` при boot `content.js`; отсутствие = обычный режим.
- В cloud mode `LLTAB.getAutorefresh` игнорируется: авто-пилот **всегда ВКЛ**, чекбокс в панели
  заблокирован с подписью «Cloud». Интервал — `ll_autorefresh.intervalMs` как сейчас (≥60 с, джиттер).
- Восстановление после рестарта Chromium делает контейнер: `START_URL=https://one.dat.com/search-loads`,
  DAT сама поднимает последний поиск (**проверено спайком 2026-09-12**: сессия DAT, логин LoadLens и
  поиск пережили пересоздание контейнера; с корня `/` DAT уходит на Dashboard, поэтому URL именно
  `/search-loads`). Стартовый скрипт образа удаляет `SingletonLock/Socket/Cookie` из профиля: после
  смены hostname контейнера Chromium иначе блокируется диалогом «profile in use on another computer».
- **`extension/cloud.js` (`LLCLOUD`)**: чистая `detectState(location, lastFindLoadsAt, now, intervalMs)`
  → `logged_out` (host `login.dat.com`) | `stale` (FindLoads не было > 3 интервалов) | `ok`.
  `POST /cloud/heartbeat {state, loadsSeen, lastFindLoadsAt}` раз в 5 минут; при попадании на страницу
  логина — немедленно.
- **Popup, секция «Cloud»** (виден при `cloud_enabled`): статус `off/starting/ok/logged_out/stale`,
  кнопки Enable Cloud / Open screen / Disable Cloud, предупреждение «Logging into DAT on this computer
  will sign out your cloud browser», чекбокс-согласие при первом Enable (§7). `LLAPI`: `cloudStatus`,
  `cloudEnable`, `cloudDisable`, `cloudScreenLink`.
- **Алерты без изменений**: `LLALERT.push` → `POST /telegram/notify`, дедуп на бэкенде общий.
- **Лимит устройств:** облачный инстанс шлёт `X-Client-Id: cloud:<instanceId>`; такие id в лимит не
  считаются и не вытесняют.
- Тесты: `cloud.test.js` (`detectState`, форс авто-пилота), `device-limit.spec.ts` (префикс `cloud:`).

## 5. Бэкенд

**Данные.** `users.cloud_enabled BOOLEAN NOT NULL DEFAULT false` (идемпотентный `ALTER TABLE` в
`main.ts`). Таблица `cloud_instances`: `id`, `user_id` (FK users, каскад, unique), `container_id`,
`status` (`starting|ok|logged_out|stale|stopped|error`), `vnc_password`, `screen_token_hash`,
`screen_token_expires`, `last_heartbeat_at`, `last_state_notified`, timestamps.

**Эндпоинты** (`JwtAuthGuard` + `CloudGuard` = `cloud_enabled`, иначе 403):
- `GET /cloud/status` → `{enabled, status, lastHeartbeatAt}`
- `POST /cloud/enable` — создаёт/перезапускает контейнер (идемпотентно), статус `starting`
- `POST /cloud/disable` — стоп, статус `stopped`, volume остаётся
- `POST /cloud/screen` → `{url}` = `CLOUD_SCREEN_BASE_URL/screen/<token>`, токен одноразовый, 15 мин, в БД хэш
- `POST /cloud/heartbeat {state, loadsSeen, lastFindLoadsAt}` → `last_heartbeat_at`, `status`
- `GET /cloud/screen/resolve?token=` — внутренний, под `X-API-Key`, для Caddy: `{container, vncPassword}`, сжигает токен
- `PATCH admin/users/:email/cloud` — админ включает/выключает `cloud_enabled`

**Docker-клиент** `docker.service.ts` (`dockerode`, mTLS): `create(userId, env)`, `start`, `stop`,
`inspect`. Контейнер `ll-<userId>`, образ `CLOUD_IMAGE`, лимиты §3, seccomp-профиль, volume
`ll-profile-<userId>`, env `VNC_PASSWORD`/`START_URL`, сеть `ll-cloud`, портов наружу нет.

**Экран.** Caddy: `/screen/<token>` → resolve у бэкенда → WebSocket-прокси на `ll-<userId>:6080` с
подстановкой пароля в noVNC-URL.

**Watchdog** (`@nestjs/schedule`, `@Cron` каждые 5 мин):
- `ok` и heartbeat старше 15 мин → рестарт контейнера, статус `stale`, DM «Cloud browser restarted».
- статус `logged_out|stale` и `last_state_notified != status` → DM через `TelegramService` с готовой
  ссылкой на экран; `last_state_notified = status`. Возврат в `ok` сбрасывает поле. Без Telegram — молчим.

**Env:** `CLOUD_DOCKER_HOST`, `CLOUD_DOCKER_CA/CERT/KEY`, `CLOUD_IMAGE`, `CLOUD_SCREEN_BASE_URL`.
Пусто → фича выключена (как `TELEGRAM_BOT_TOKEN`).

**Админка:** колонка «Cloud» (статус + heartbeat) и переключатель `cloud_enabled` в `/admin.html`.

**Тесты:** `cloud.service.spec.ts` с моком `DockerService` — enable идемпотентен, screen-токен
одноразовый и протухает, watchdog шлёт DM один раз на смену статуса.

## 6. ToS-граница

Облачный браузер — личное рабочее место пользователя, перенесённое с домашнего ПК на наш сервер.
Логин делает сам пользователь, пароли мы не видим и не храним, cookies не переносим, запросов к API DAT
не инициируем, авто-пилот тот же, что локально (≥60 с с джиттером, клик по UI DAT / reload). Сдвиг
относительно локального режима: DAT-сессия работает без человека за экраном, с датацентрового IP, и
физически хранится у нас. Это дальше, чем DOM-overlay у LoadConnect/LoadHunter, но не путь Convoy
(прямых вызовов GraphQL/REST с токеном по-прежнему нет).

При первом Enable пользователь подтверждает чекбоксом: «You are responsible for your DAT account;
DAT may restrict accounts used from cloud servers». Наружу через наш API — по-прежнему только агрегат.

## 7. Риски и страховки

| # | риск | страховка |
|---|---|---|
| 1 | DAT блокирует датацентровый IP / аккаунты с него | ответ даст спайк Q2; ≤10 аккаунтов на IP, докупка адресов; при «нет» — продукт в стол до партнёрства, мини-ПК остаётся рекомендацией |
| 2 | DAT-сессия протухает без активности человека | спайк Q3; watchdog `logged_out` → DM с ссылкой; чаще раза в сутки = продукт неудобен |
| 3 | компрометация сервера = DAT-сессии всех тенантов | шифрованный диск, Docker API по mTLS с одного IP, noVNC только по одноразовым токенам, без бэкапов volume, удаление через 30 дней |
| 4 | Chromium течёт на reload-цикле | `mem 2g`, OOM-kill перезапускает только Chromium (supervisord), профиль на диске |
| 5 | пользователь логинится локально и теряет алерты | DM «cloud signed out» в течение минуты + предупреждение в попапе |

## 8. Спайк и порядок раскатки

Спайк `cloud-browser/spike/` (throwaway), задача `tasks/0013-cloud-browser-spike.md`:
- **Q1 — ответ есть:** одна активная сессия на аккаунт DAT (→ §1).
- **Q2 — открыт:** логин в DAT с датацентрового IP в Ashburn без капчи/блока. Нужен VPS.
- **Q3 — частично:** восстановление поиска после рестарта Chromium — да (см. §4). Открыто:
  живучесть сессии без человека при авто-пилоте 60–120 с и RAM за сутки.

Раскатка:
1. Ответы Q2/Q3. Без «да» по Q2 спека не реализуется.
2. Образ `cloud-browser/` в репо (прод-Dockerfile + seccomp + managed policy), сборка в GHCR через GitHub Actions.
3. Бэкенд `cloud/` + `extension/cloud.js` + popup за фича-флагом `CLOUD_DOCKER_HOST`.
4. US-сервер: Docker + mTLS + Caddy; один тенант (наш аккаунт), неделя наблюдения.
5. Лид из Fontana — первый клиент «Pro Cloud», демо по Skype на облачном экране.
6. Лендинг: «for owner-operators and small fleets; one DAT session at a time».

Не делаем: автологин, хранение паролей, перенос cookies, Kubernetes, несколько инстансов на
пользователя, WebRTC-стрим, второй регион, автоскейл.
