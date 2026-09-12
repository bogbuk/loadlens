# LoadLens Cloud — браузер в облаке как единственное рабочее место DAT

Дата: 2026-09-12 (ревизия 2 — оркестрация через Coolify API, цены Hetzner US после 15.06.2026; ресерч —
`docs/research/2026-09-12-cloud-browser-coolify-hetzner.md`). Статус: дизайн утверждён, **реализация
заблокирована до ответов спайка** (вопросы 2 и 3, см. §8).

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
24/7, IP-пулы в бан-листах), резидентные прокси (осознанный обход антибота), neko (WebRTC мимо Traefik,
UDP-порты на тенанта) и linuxserver/chromium (терминал с passwordless sudo, только basic-auth), свой
Docker-оркестратор через dockerode+mTLS+Caddy (ревизия 1 — заменён на Coolify API, см. §2).

## 2. Архитектура

```
popup «Cloud» ─JWT─▶ backend /cloud/* ─Coolify API (host.docker.internal:8000)─▶ Coolify ─SSH─▶ US-сервер (Hetzner ash)
                          │                                                        ├─ Traefik: ll-<userId>.cloud.loadlens.krait.studio ─▶ ll-<userId>:6080 (noVNC, WSS)
                          │                                                        └─ service ll-<userId>: Xvfb + x11vnc + websockify + Chromium(--load-extension)
                          ▼                                                             volume (DAT-сессия)
                    Telegram DM ◀── watchdog (@Cron 5 мин)  ◀── heartbeat из расширения (cloud mode)
```

Компоненты:
- **Образ `cloud-browser/`** — Chrome + Xvfb + x11vnc + noVNC + распакованное расширение (`extension/` из
  того же коммита), собирается GitHub Actions в `ghcr.io/bogbuk/loadlens-cloud-browser`. Спайк
  `cloud-browser/spike/` — заготовка. Прод-доработки: `hostname` фиксирован (нет диалога «profile in use»,
  `rm SingletonLock` остаётся страховкой), на x86 `google-chrome-stable`, managed-policy файл задаёт
  `ll_cloud_mode: true`, seccomp-профиль (`security_opt: seccomp:/etc/docker/seccomp/chrome.json`,
  файл на хост кладёт cloud-init) вместо `--no-sandbox` — второй шаг, MVP идёт с `--no-sandbox` под uid 1000.
- **Оркестратор** `backend/src/cloud/` — таблица `cloud_instances`, клиент Coolify API, ссылка на экран,
  watchdog. **Coolify — единственный Docker-оркестратор**: один тенант = один Coolify Service (custom
  compose) на US-сервере; Coolify же держит Traefik, TLS и домены. Никакого прямого Docker API.
- **Cloud mode в расширении** — `extension/cloud.js` (`LLCLOUD`): форс авто-пилота, heartbeat, детект
  вытеснения.
- **Экран по ссылке** — домен на тенанта от Traefik Coolify; noVNC наружу без пароля не торчит (§5).

Один сервис на пользователя, один сервер, никакого автоскейла (YAGNI).

**Compose тенанта** (шаблон в `backend/src/cloud/compose.template.yaml`, уходит в `docker_compose_raw`):

```yaml
services:
  browser:
    image: ghcr.io/bogbuk/loadlens-cloud-browser:${IMAGE_TAG}
    hostname: ll-${LL_USER_ID}
    environment:
      - SERVICE_FQDN_BROWSER_6080          # Coolify: домен → порт 6080, TLS, WebSocket
      - NOVNC_PASSWORD=${SERVICE_PASSWORD_VNC}
      - START_URL=https://one.dat.com/search-loads
      - SCREEN=1440x900x24
    volumes:
      - profile:/data
    shm_size: 512m
    mem_limit: 2g
    cpus: 1
    pids_limit: 512
    restart: unless-stopped
volumes:
  profile:
```

Лимиты — только в compose: UI-лимиты Coolify на compose-сервисы не применяются (issue #10676).
Портов наружу нет, Traefik ходит в контейнер по docker-сети сервиса.

## 3. Инфраструктура и деньги

- **Сервер:** Hetzner Cloud в Ашберне (`ash`). В США у Hetzner **только Cloud** (CPX/CCX), dedicated
  (AX/Robot) нет. Цены после 15.06.2026 (США, excl. IPv4 $0.60):

  | тип | vCPU | RAM | $/мес | тенантов (2 GB лимит) | $/тенант |
  |---|---|---|---|---|---|
  | **CCX23** | 4 dedicated | 16 GB | **102.99** | ~7 | ~15 |
  | **CCX33** | 8 dedicated | 32 GB | **165.99** | ~14 | ~12 |
  | CPX41 | 8 shared | 16 GB | 141.49 | ~7 | ~20 |

  Старт — **CCX23** (наш аккаунт + лид из Fontana + запас), при >6 тенантах — CCX33. Провижинит Coolify
  (`coolify server hetzner create --location ash --server-type ccx23 …` по cloud-token), cloud-init ставит
  seccomp-профиль, `docker login ghcr.io`, ufw (22/80/443). Трафик США 1–8 TB включено — хватает: noVNC
  грузит сеть только пока экран открыт.
- **Ресурсы на тенанта** (замер спайка, выдача 2849 грузов): RAM ~1.2 GB, CPU ~0.35 ядра. Лимиты
  контейнера: `mem 2g`, `cpus 1`, `shm 512m`, `pids 512`. **Себестоимость $12–15/тенант/мес** (не €2–4,
  как в ревизии 1).
- **Один IP на всех тенантов** — главный инфраструктурный риск (§7). Не более ~10 DAT-аккаунтов на IP;
  на CCX23 это не превышается. Дальше — Floating IPv4 ($3.50/мес) + SNAT-правила на хосте, не в MVP.
- **Хранение:** named volume на тенанта (~300 MB) с DAT-сессией. Диск шифрован, бэкапов volume нет,
  удаление через 30 дней после Disable (`DELETE /services/{uuid}?delete_volumes=true`).
- **Тариф (предварительно, решение владельца):** план «Pro Cloud» $59/мес, включает Pro. Маржа при
  $12–15 себестоимости ≈ $44–47/тенант. Stripe нет — включает админ (`cloud_enabled`). Лид из Fontana:
  $59/мес + $149 разово за настройку.

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
`main.ts`). Таблица `cloud_instances`: `id`, `user_id` (FK users, каскад, unique), `coolify_service_uuid`,
`status` (`starting|ok|logged_out|stale|stopped|error`), `screen_token_hash`, `screen_token_expires`,
`last_heartbeat_at`, `last_state_notified`, `disabled_at`, timestamps. Пароль VNC у нас не хранится —
его генерит и хранит Coolify (`SERVICE_PASSWORD_VNC`), бэкенд читает при выдаче ссылки.

**Эндпоинты** (`JwtAuthGuard` + `CloudGuard` = `cloud_enabled`, иначе 403):
- `GET /cloud/status` → `{enabled, status, lastHeartbeatAt}`
- `POST /cloud/enable` — создаёт сервис (`POST /services`, `instant_deploy`) или стартует остановленный
  (`POST /services/{uuid}/start`); идемпотентно, статус `starting`
- `POST /cloud/disable` — `POST /services/{uuid}/stop`, статус `stopped`, `disabled_at=now()`, volume остаётся
- `POST /cloud/screen` → `{url}` — см. «Экран»
- `POST /cloud/heartbeat {state, loadsSeen, lastFindLoadsAt}` → `last_heartbeat_at`, `status`
- `GET /cloud/screen/verify` — для Traefik forwardAuth (второй шаг, см. «Экран»)
- `PATCH admin/users/:email/cloud` — админ включает/выключает `cloud_enabled`

**Клиент Coolify** `coolify.service.ts` (HTTP, `Authorization: Bearer`): `createService(userId)` (compose
из шаблона §2, base64, `server_uuid`/`project_uuid`/`environment_name` из env), `start`, `stop`, `restart`,
`delete(deleteVolumes)`, `getEnvs` (пароль VNC, домен), `updateEnv` (ротация пароля). Токен Coolify —
**отдельный, write+deploy** (у `yoolip999` права `deploy` нет). API Coolify у нас на plain HTTP — бэкенд
ходит по внутреннему адресу (`host.docker.internal:8000`), токен наружу не уходит.

**Экран.** Два уровня:
1. MVP: `POST /cloud/screen` отдаёт `https://ll-<userId>.cloud.loadlens.krait.studio/vnc.html?autoconnect=1&resize=scale&password=<vnc>`.
   Пароль — секрет Coolify; на Disable/Enable ротируется (`updateEnv` + `restart`). Минус: ссылка
   долгоживущая, TTL 15 мин не соблюдается — принято для MVP (аудитория — 1–2 пользователя).
2. Второй шаг: Traefik `forwardAuth` → `GET /cloud/screen/verify?token=` (одноразовый токен, 15 мин,
   в БД хэш). Middleware описывается один раз в dynamic-config Traefik US-сервера
   (`ll-screen-auth@file`), в compose тенанта — один label `traefik.http.routers.<router>.middlewares=`.
   Перед внедрением проверить, что label переживает парсер Coolify (issue #6939).

**Watchdog** (`@nestjs/schedule`, `@Cron` каждые 5 мин):
- `ok` и heartbeat старше 15 мин → `POST /services/{uuid}/restart`, статус `stale`, DM «Cloud browser restarted».
- статус `logged_out|stale` и `last_state_notified != status` → DM через `TelegramService` с готовой
  ссылкой на экран; `last_state_notified = status`. Возврат в `ok` сбрасывает поле. Без Telegram — молчим.
- `stopped` и `disabled_at` старше 30 дней → `DELETE /services/{uuid}?delete_volumes=true`, строка удаляется.

**Env:** `COOLIFY_API_URL`, `COOLIFY_API_TOKEN`, `COOLIFY_CLOUD_SERVER_UUID`, `COOLIFY_CLOUD_PROJECT_UUID`,
`COOLIFY_CLOUD_ENV_NAME` (`production`), `CLOUD_IMAGE_TAG`, `CLOUD_SCREEN_DOMAIN` (`cloud.loadlens.krait.studio`).
Пусто `COOLIFY_API_URL` → фича выключена (как `TELEGRAM_BOT_TOKEN`).

**Админка:** колонка «Cloud» (статус + heartbeat) и переключатель `cloud_enabled` в `/admin.html`.

**Тесты:** `cloud.service.spec.ts` с моком `CoolifyService` — enable идемпотентен (существующий сервис
стартует, а не создаётся заново), watchdog шлёт DM один раз на смену статуса, удаление через 30 дней;
`coolify.service.spec.ts` — compose из шаблона кодируется в base64 и содержит `hostname`/`mem_limit`.

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
| 1 | DAT блокирует датацентровый IP / аккаунты с него | ответ даст спайк Q2; ≤10 аккаунтов на IP, Floating IP при росте; при «нет» — продукт в стол до партнёрства, мини-ПК остаётся рекомендацией |
| 2 | DAT-сессия протухает без активности человека | спайк Q3; watchdog `logged_out` → DM с ссылкой; чаще раза в сутки = продукт неудобен |
| 3 | компрометация сервера = DAT-сессии всех тенантов | шифрованный диск, ufw 22/80/443, Coolify по SSH-ключу, noVNC только по паролю/forwardAuth, без бэкапов volume, удаление через 30 дней |
| 4 | Chromium течёт на reload-цикле | `mem 2g` в compose, OOM-kill перезапускает только Chromium (supervisord), профиль на диске |
| 5 | пользователь логинится локально и теряет алерты | DM «cloud signed out» в течение минуты + предупреждение в попапе |
| 6 | парсер Coolify выкинет `security_opt`/`hostname`/labels | `docker inspect` после первого деплоя (шаг 5 раскатки); fallback — Raw Compose Deployment (тогда labels Traefik пишем сами) |
| 7 | Coolify (в Германии) недоступен | контейнеры на US-сервере живут сами (`restart: unless-stopped`), теряется только управление; экран и алерты работают |
| 8 | цена Hetzner US ×3 (себестоимость $12–15) | старт на CCX23; при ≥10 тенантах пересчитать Vultr / DigitalOcean / OVH US |

## 8. Спайк и порядок раскатки

Спайк `cloud-browser/spike/` (throwaway), задача `tasks/0013-cloud-browser-spike.md`:
- **Q1 — ответ есть:** одна активная сессия на аккаунт DAT (→ §1).
- **Q2 — открыт:** логин в DAT с датацентрового IP в Ашберне без капчи/блока. Нужен US-сервер (шаг 2).
- **Q3 — частично:** восстановление поиска после рестарта Chromium — да (см. §4). Открыто:
  живучесть сессии без человека при авто-пилоте 60–120 с и RAM за сутки.

Раскатка:
1. Токены: Hetzner Cloud API-токен → `coolify cloud-token create`; Coolify API-токен `loadlens-backend` (write+deploy).
2. US-сервер: `coolify server hetzner create --location ash --server-type ccx23 --image <ubuntu-24.04>
   --private-key <uuid> --cloud-init cloud-browser/cloud-init.yaml --validate`. DNS: Cloudflare
   `*.cloud.loadlens.krait.studio` → IP сервера; в Coolify у сервера wildcard domain.
3. Образ `cloud-browser/` в репо (прод-Dockerfile + managed policy + cloud-init с seccomp), сборка в GHCR
   через GitHub Actions.
4. Первый тенант руками (Coolify UI → Docker Compose Empty → шаблон §2, наш аккаунт): логин в DAT через
   экран → **ответ Q2**; `docker inspect` → `mem_limit`/`shm_size`/`hostname`; сутки авто-пилота → **ответ Q3**.
   Без «да» по Q2 дальше не идём.
5. Бэкенд `cloud/` + `coolify.service.ts` + `extension/cloud.js` + popup за фича-флагом `COOLIFY_API_URL`.
6. Неделя наблюдения на нашем аккаунте; затем лид из Fontana — первый клиент «Pro Cloud», демо по Skype
   на облачном экране.
7. Лендинг: «for owner-operators and small fleets; one DAT session at a time».

Не делаем: автологин, хранение паролей, перенос cookies, свой Docker-оркестратор, Kubernetes, несколько
инстансов на пользователя, WebRTC-стрим, второй регион, автоскейл.
