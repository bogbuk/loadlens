# LoadLens Cloud (браузер в облаке) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pro-пользователь с флагом `cloud_enabled` включает в попапе «Cloud» и получает свой Chromium с DAT One и LoadLens на нашем сервере 24/7 (авто-пилот + Telegram-алерты без компьютера дома), с экраном по ссылке и watchdog-уведомлениями.

**Architecture:** Прод-образ `cloud-browser/` (Chromium + Xvfb + x11vnc + noVNC + распакованное расширение) собирается GitHub Actions в GHCR. Бэкенд-модуль `backend/src/cloud/` через **Coolify API** создаёт один Coolify Service (custom compose) на пользователя на **том же немецком сервере 46.4.25.36**, хранит строку `cloud_instances`, отдаёт ссылку на экран, принимает heartbeat и крутит watchdog (`@nestjs/schedule`). Расширение в cloud mode (файл `cloud.config.js`, который генерит стартовый скрипт контейнера из env) форсит авто-пилот, шлёт heartbeat и представляется `X-Client-Id: cloud:<instanceId>` (не занимает слот лимита устройств).

**Tech Stack:** Docker (debian chromium, supervisord, novnc), GitHub Actions → GHCR, Coolify REST API v1, NestJS 10 + Sequelize + `@nestjs/schedule` + jest, MV3-расширение (vanilla JS, `node --test`).

**Spec:** `docs/superpowers/specs/2026-09-12-loadlens-cloud-browser-design.md` (ревизия 3 — см. «Отклонения от спеки» ниже; ресерч API — `docs/research/2026-09-12-cloud-browser-coolify-hetzner.md`).

## Global Constraints

- **Хостинг — DE-сервер 46.4.25.36** (решение 2026-09-13): Coolify server uuid `f8xhhqagybtdjk14krvrp0kq`, project `ocls09doyppd1f5ze0fsjj8r`, environment `production`. Новый US-сервер и cloud-init НЕ создаём.
- **Coolify — единственный оркестратор.** Никакого прямого Docker API/dockerode. Лимиты — только в compose (`mem_limit: 2g`, `cpus: 1`, `shm_size: 512m`, `pids_limit: 512`).
- **ToS:** автологина, хранения паролей DAT, переноса cookies, прямых вызовов GraphQL/REST DAT — нет. Авто-пилот тот же, что локально (≥60 с + джиттер).
- Фича-флаг бэкенда — `COOLIFY_API_URL` (пусто → `/cloud/*` отвечает 503, watchdog молчит), как `TELEGRAM_BOT_TOKEN`.
- Статусы инстанса: `starting | ok | logged_out | stale | stopped | error`. Heartbeat-состояния расширения: `ok | logged_out | stale` (`stale` = FindLoads не было дольше 3 интервалов авто-пилота).
- Watchdog: `ok` + heartbeat старше **15 мин** → restart + статус `stale`; `logged_out|stale` → DM один раз на смену статуса; `stopped` + `disabled_at` старше **30 дней** → удаление сервиса с volume.
- User-facing строки расширения/бэкенда — **только английский** (`npm run check:lang`). Комментарии в коде — по-русски.
- Коммиты без упоминания AI. Тесты: корень `npm test`, бэкенд `cd backend && npm test`.
- Файл задачи `tasks/0018-loadlens-cloud-browser.md` создаётся в Task 1 и обновляется по ходу.
- **Предусловие (закрыто параллельной сессией 2026-09-13, коммит `aaf2977`):** продовый баг авто-пилота — `dat.adapter.findRefreshButton` кликал «SEARCH BACK - 24 HRS» вместо reload. Перед Task 1 убедиться, что `aaf2977` в `main` (`git log --oneline | grep aaf2977`) и хотфикс ушёл в Web Store (релиз 0.6.1 — по чек-листу `tasks/0017`). Финальный Q3 **под reload-циклом** ещё не отвечен: повторить суточный тест на первом тенанте (Task 13, Step 10).
- **Открытый вопрос спеки (в §4/§8, не в этом плане):** Date Range поиска DAT — абсолютная дата; на следующий день выдача 24/7-режима протухает. Нужен поиск с диапазоном дат или авто-сдвиг даты — отдельное решение после недели наблюдения.

## Отклонения от спеки (ревизия 3, зафиксировать в спеке в Task 1)

1. **DE вместо US** (см. выше). `COOLIFY_API_URL` — внутренний адрес Coolify из docker-сети (`http://coolify:8080`), проверяется в Task 13.
2. **Cloud mode — не managed policy, а сгенерированный `extension/cloud.config.js`.** Managed policy требует пиновать extension-id (`key` в манифесте) и `storage.managed_schema`; файл `cloud.config.js` (`globalThis.LL_CLOUD = {mode:true, instanceId}`) пишет `start-chromium.sh` из env `LL_INSTANCE_ID`. Суть требования спеки («cloud mode задаётся конфигом образа, не кликами») сохранена.
3. **Пароль VNC генерит и хранит бэкенд** (`cloud_instances.vnc_password`), в контейнер уходит через Coolify env `NOVNC_PASSWORD`. Ссылка на экран = `https://<domain>/vnc.html?autoconnect=1&resize=scale&password=<vnc>`; попап дополнительно показывает пароль с кнопкой Copy (если noVNC сборки игнорирует `?password=`, пользователь вставит его сам).
4. **`X-Client-Id: cloud:<instanceId>` не занимает слот лимита устройств только если `instanceId` — строка `cloud_instances` этого пользователя** (иначе — обычное устройство). Спека не оговаривала защиту от подделки префикса.
5. **Ежесуточный recycle Chromium в образе** (`CHROMIUM_RECYCLE_HOURS`, дефолт 12): промежуточный Q3 (13.09, 15 ч) показал рост RAM 1.18 → 1.67 GB при лимите 2 GB.
6. Образ остаётся на Debian `chromium` (проверен спайком), не `google-chrome-stable`.
7. DNS `*.cloud.loadlens.krait.studio` — **DNS-only (без прокси Cloudflare)**: Universal SSL Cloudflare покрывает только один уровень (`*.krait.studio`), TLS выдаёт Traefik Coolify (Let's Encrypt).

---

## File Structure

| Файл | Ответственность |
|---|---|
| `cloud-browser/Dockerfile`, `start-chromium.sh`, `supervisord.conf`, `README.md` (новые) | Прод-образ: Chromium + Xvfb + x11vnc + noVNC + `/ext`; генерация `cloud.config.js`; recycle Chromium. Спайк `cloud-browser/spike/` остаётся как есть (throwaway). |
| `.github/workflows/cloud-browser.yml` (новый) | Сборка образа в `ghcr.io/bogbuk/loadlens-cloud-browser` (`latest` + `sha-<7>`). |
| `extension/cloud.config.js` (новый, заглушка) | В репо — пустой; в контейнере — `globalThis.LL_CLOUD`. |
| `extension/cloud.js` + `cloud.test.js` (новые) | `LLCLOUD`: чистые `config`, `clientIdFor`, `detectState`, `heartbeat`, `due`, метки в sessionStorage. |
| `extension/api.js` + `api.test.js` | `clientId()` с префиксом `cloud:`; `cloudStatus/cloudEnable/cloudDisable/cloudScreen/cloudHeartbeat`; `getMe` кэширует `cloudEnabled`. |
| `extension/content.js`, `manifest.json` | Cloud mode: форс авто-пилота, чекбокс панели disabled, heartbeat. |
| `extension/popup.html`, `popup.js` | Секция «Cloud browser». |
| `backend/src/cloud/cloud-instance.model.ts` | Таблица `cloud_instances`. |
| `backend/src/cloud/coolify.service.ts` + `.spec.ts` | HTTP-клиент Coolify + `renderCompose`. |
| `backend/src/cloud/cloud-watchdog.ts` + `.spec.ts` | Чистая `decideWatchdog(rows, now)`. |
| `backend/src/cloud/cloud.service.ts` + `.spec.ts` | enable/disable/status/screen/heartbeat + cron-обвязка watchdog. |
| `backend/src/cloud/cloud.guard.ts`, `cloud.controller.ts`, `cloud.module.ts`, `dto/heartbeat.dto.ts` | HTTP-слой. |
| `backend/src/users/user.model.ts`, `main.ts`, `app.module.ts` | `cloud_enabled`, `ScheduleModule`, регистрация модели/модуля. |
| `backend/src/auth/auth.service.ts` (+spec) | `/auth/me` отдаёт `cloudEnabled`. |
| `backend/src/auth/devices.service.ts` (+spec), `auth.module.ts` | Пропуск `cloud:<id>` в лимите устройств. |
| `backend/src/auth/admin.service.ts`, `admin.controller.ts`, `dto/admin.dto.ts`, `backend/public/admin.html` | Тумблер `cloud_enabled` + колонка Cloud. |
| `backend/.env.example`, `CLAUDE.md`, `CHANGELOG.md`, `tasks/0018-loadlens-cloud-browser.md`, спека | Документация. |

---

### Task 1: Задача, ревизия спеки, прод-образ `cloud-browser/`

**Files:**
- Create: `tasks/0018-loadlens-cloud-browser.md`
- Modify: `docs/superpowers/specs/2026-09-12-loadlens-cloud-browser-design.md` (шапка + §2/§3/§4/§8)
- Create: `cloud-browser/Dockerfile`, `cloud-browser/start-chromium.sh`, `cloud-browser/supervisord.conf`, `cloud-browser/README.md`
- Create: `.github/workflows/cloud-browser.yml`

**Interfaces:**
- Produces: образ `ghcr.io/bogbuk/loadlens-cloud-browser:<tag>`; env контейнера `LL_INSTANCE_ID`, `NOVNC_PASSWORD`, `START_URL`, `SCREEN`, `CHROMIUM_RECYCLE_HOURS`; порт 6080; volume `/data`; файл `/ext/cloud.config.js` с `globalThis.LL_CLOUD = {mode:true, instanceId:"<LL_INSTANCE_ID>"}` (используется Task 2).

- [ ] **Step 1: Файл задачи** — уже создан вместе с планом (2026-09-13); сверить с чек-листом ниже и обновлять по ходу.

```markdown
# Task: LoadLens Cloud — браузер в облаке (образ, backend/cloud, extension cloud mode, popup)
Date: 2026-09-13
Status: in_progress

## Checklist
- [ ] Task 1: спека рев.3, прод-образ cloud-browser/, workflow GHCR
- [ ] Task 2: extension/cloud.js (LLCLOUD) + cloud.config.js
- [ ] Task 3: LLAPI cloud-вызовы + clientId cloud:
- [ ] Task 4: content.js cloud mode + heartbeat + manifest
- [ ] Task 5: backend — модель cloud_instances, users.cloud_enabled, /auth/me
- [ ] Task 6: backend — CoolifyService + renderCompose (после ручной проверки API)
- [ ] Task 7: backend — CloudService/Guard/Controller/Module
- [ ] Task 8: backend — watchdog
- [ ] Task 9: backend — лимит устройств пропускает cloud:<id>
- [ ] Task 10: backend — админка cloud_enabled
- [ ] Task 11: popup — секция Cloud browser
- [ ] Task 12: документация (CLAUDE.md, .env.example, CHANGELOG)
- [ ] Task 13: раскатка — токен Coolify, DNS, GHCR, env, первый тенант (наш аккаунт)
### Verification
- [ ] npm test (корень) + cd backend && npm test
- [ ] docker build cloud-browser/ + smoke
- [ ] commit & push (автодеплой) + docker inspect первого тенанта
```

- [ ] **Step 2: Ревизия спеки** — в шапке заменить «Дата: 2026-09-12 (ревизия 2 …)» на «Дата: 2026-09-13 (ревизия 3 — хостинг на DE-сервере 46.4.25.36, cloud mode через `cloud.config.js`, пароль VNC у бэкенда, recycle Chromium; план — `docs/superpowers/plans/2026-09-13-loadlens-cloud-browser.md`)». В §3 первым абзацем добавить: «**Ревизия 3:** первые тенанты — на существующем DE-сервере (Coolify там же, логин в DAT с 46.4.25.36 прошёл без капчи 12.09, ёмкость 20–25 тенантов, доп. затрат нет); US-сервер — при жалобах DAT на не-US IP или >15 тенантах, архитектура не меняется (`COOLIFY_CLOUD_SERVER_UUID`).» В §4 абзац про `ll_cloud_mode`/`chrome.storage.managed` заменить на: «`extension/cloud.config.js` — в репо заглушка; стартовый скрипт образа пишет в него `globalThis.LL_CLOUD = {mode:true, instanceId}` из env `LL_INSTANCE_ID`. Managed policy отвергнута: требует пиновать extension-id и managed_schema.» В §5 «Пароль VNC у нас не хранится» заменить на «Пароль VNC генерит бэкенд (`cloud_instances.vnc_password`), в контейнер уходит через Coolify env `NOVNC_PASSWORD`; ротация на Disable/Enable». В §8 Q3 дописать: «Снят 13.09 (15,5 ч, `tasks/0013`): сессия без человека жива, RAM 1.18 → 1.67 GB без reload-цикла → в образ добавлен recycle Chromium каждые `CHROMIUM_RECYCLE_HOURS` (12); авто-пилот не обновлял выдачу из-за продового бага `findRefreshButton` (фикс `aaf2977`); живучесть под reload-циклом — повторить на первом тенанте. Открыто: Date Range поиска — абсолютная дата, выдача 24/7-режима протухает на следующий день (диапазон дат / авто-сдвиг — отдельное решение)». Скопировать раздел «Отклонения от спеки» этого плана в конец §8.

- [ ] **Step 3: Dockerfile**

```dockerfile
# Прод-образ LoadLens Cloud: Chromium + Xvfb + x11vnc + noVNC + распакованное расширение LoadLens.
# Контекст сборки — корень репозитория (нужен каталог extension/). Собирается GitHub Actions → GHCR.
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium xvfb x11vnc novnc websockify supervisor \
      fonts-liberation fonts-noto-color-emoji ca-certificates procps curl \
    && rm -rf /var/lib/apt/lists/*

# Расширение из того же коммита + постоянный профиль Chromium (volume /data)
COPY extension/ /ext/
RUN useradd -m -u 1000 browser && mkdir -p /data /var/log/supervisor \
    && chown -R browser:browser /data /ext

COPY cloud-browser/supervisord.conf /etc/supervisor/conf.d/browser.conf
COPY cloud-browser/start-chromium.sh /usr/local/bin/start-chromium.sh
RUN chmod +x /usr/local/bin/start-chromium.sh

ENV DISPLAY=:99 \
    SCREEN=1440x900x24 \
    START_URL=https://one.dat.com/search-loads \
    NOVNC_PASSWORD=changeme \
    LL_INSTANCE_ID= \
    CHROMIUM_RECYCLE_HOURS=12

EXPOSE 6080
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:6080/vnc.html >/dev/null || exit 1
CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
```

- [ ] **Step 4: start-chromium.sh**

```sh
#!/bin/sh
# Ждём X-сервер, пишем cloud-конфиг расширения, снимаем чужой SingletonLock, стартуем Chromium.
for i in $(seq 1 50); do [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ] && break; sleep 0.2; done

# Cloud mode расширения: content.js/popup читают globalThis.LL_CLOUD из cloud.config.js.
# Без LL_INSTANCE_ID файл остаётся заглушкой из репо — обычный режим (удобно для локального smoke).
if [ -n "$LL_INSTANCE_ID" ]; then
  printf 'globalThis.LL_CLOUD = { mode: true, instanceId: "%s" };\n' "$LL_INSTANCE_ID" > /ext/cloud.config.js
fi

# Профиль лежит в volume: после пересоздания контейнера остаётся чужой SingletonLock, и Chromium
# показывает диалог «profile in use on another computer». hostname у нас фиксирован, lock — страховка.
rm -f /data/profile/SingletonLock /data/profile/SingletonSocket /data/profile/SingletonCookie
WH=$(echo "$SCREEN" | cut -d x -f1,2 | tr x ,)
exec /usr/bin/chromium \
  --user-data-dir=/data/profile \
  --load-extension=/ext \
  --disable-extensions-except=/ext \
  --no-sandbox --no-first-run --no-default-browser-check \
  --disable-dev-shm-usage --disable-gpu \
  --password-store=basic \
  --window-position=0,0 --window-size="$WH" \
  --disable-features=TranslateUI \
  --lang=en-US \
  "$START_URL"
```

- [ ] **Step 5: supervisord.conf** (как в спайке + recycle)

```ini
[program:xvfb]
command=/usr/bin/Xvfb %(ENV_DISPLAY)s -screen 0 %(ENV_SCREEN)s -nolisten tcp
priority=10
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:x11vnc]
command=/bin/sh -c "x11vnc -storepasswd \"$NOVNC_PASSWORD\" /tmp/vncpass >/dev/null 2>&1 && exec x11vnc -display %(ENV_DISPLAY)s -rfbauth /tmp/vncpass -forever -shared -rfbport 5900 -localhost -noxdamage -quiet"
priority=20
autorestart=true
startsecs=2
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:novnc]
command=/usr/bin/websockify --web /usr/share/novnc 0.0.0.0:6080 localhost:5900
priority=30
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

[program:chromium]
command=/usr/local/bin/start-chromium.sh
user=browser
environment=HOME="/home/browser",DISPLAY="%(ENV_DISPLAY)s"
priority=40
autorestart=true
startsecs=3
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0

; Chromium на reload-цикле течёт (~30 MB/ч по спайку Q3). Раз в CHROMIUM_RECYCLE_HOURS перезапускаем
; только Chromium: профиль на диске, DAT восстанавливает последний поиск по START_URL=/search-loads.
[program:recycle]
command=/bin/sh -c "while true; do sleep $(( ${CHROMIUM_RECYCLE_HOURS:-12} * 3600 )); supervisorctl -c /etc/supervisor/supervisord.conf restart chromium; done"
priority=50
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
```

- [ ] **Step 6: README.md** — 15 строк: назначение, env-переменные (таблица из Step 3), локальный smoke:

```bash
docker build -f cloud-browser/Dockerfile -t loadlens-cloud-browser:dev .
docker run -d --name llc-smoke -p 6080:6080 -e LL_INSTANCE_ID=test-1 -e NOVNC_PASSWORD=changeme \
  --shm-size 512m -m 2g loadlens-cloud-browser:dev
# http://localhost:6080/vnc.html?autoconnect=1&resize=scale&password=changeme
docker exec llc-smoke cat /ext/cloud.config.js     # → globalThis.LL_CLOUD = { mode: true, instanceId: "test-1" };
docker exec llc-smoke supervisorctl -c /etc/supervisor/supervisord.conf status  # 5 программ RUNNING
docker rm -f llc-smoke
```

- [ ] **Step 7: GitHub Actions workflow**

```yaml
name: cloud-browser image
on:
  push:
    branches: [main]
    paths: ['cloud-browser/**', 'extension/**', '.github/workflows/cloud-browser.yml']
  workflow_dispatch:
permissions:
  contents: read
  packages: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: cloud-browser/Dockerfile
          push: true
          tags: |
            ghcr.io/bogbuk/loadlens-cloud-browser:latest
            ghcr.io/bogbuk/loadlens-cloud-browser:sha-${{ github.sha }}
```

- [ ] **Step 8: Локальная сборка и smoke** — выполнить команды из Step 6. Ожидание: `cloud.config.js` содержит `instanceId: "test-1"`; `supervisorctl status` — `xvfb`, `x11vnc`, `novnc`, `chromium`, `recycle` в `RUNNING`; страница noVNC открывается; **зафиксировать в README**, подключился ли noVNC без запроса пароля по `?password=` (нужно для Task 11).

- [ ] **Step 9: Коммит**

```bash
git add tasks/0018-loadlens-cloud-browser.md docs/superpowers/specs/2026-09-12-loadlens-cloud-browser-design.md cloud-browser/Dockerfile cloud-browser/start-chromium.sh cloud-browser/supervisord.conf cloud-browser/README.md .github/workflows/cloud-browser.yml
git commit -m "feat(cloud): прод-образ cloud-browser + workflow GHCR, спека рев.3 (DE-хостинг)"
```

---

### Task 2: `extension/cloud.js` — чистый `LLCLOUD` + заглушка `cloud.config.js`

**Files:**
- Create: `extension/cloud.config.js`, `extension/cloud.js`, `extension/cloud.test.js`

**Interfaces:**
- Consumes: `globalThis.LL_CLOUD` (Task 1).
- Produces: `LLCLOUD.config(g) → {instanceId}|null`; `LLCLOUD.clientIdFor(cfg, localId) → string`; `LLCLOUD.detectState({hostname, lastFindLoadsAt, now, intervalMs}) → 'ok'|'logged_out'|'stale'`; `LLCLOUD.heartbeat({hostname, lastFindLoadsAt, now, intervalMs, loadsSeen}) → {state, loadsSeen, lastFindLoadsAt}`; `LLCLOUD.markFindLoads(ss, now)`, `LLCLOUD.lastFindLoads(ss) → number|null`, `LLCLOUD.markHeartbeat(ss, now, state)`, `LLCLOUD.due(ss, now, state) → boolean`; константы `HEARTBEAT_MS = 300000`, `STALE_INTERVALS = 3`.

- [ ] **Step 1: Заглушка `extension/cloud.config.js`**

```js
/* LoadLens cloud mode. В репозитории — заглушка (обычный режим). В облачном образе
   cloud-browser/start-chromium.sh перезаписывает файл строкой
   globalThis.LL_CLOUD = { mode: true, instanceId: "<LL_INSTANCE_ID>" }; */
```

- [ ] **Step 2: Тесты `extension/cloud.test.js`**

```js
const test = require("node:test");
const assert = require("node:assert");
const LLCLOUD = require("./cloud.js");

function fakeSS(init) {
  const store = { ...(init || {}) };
  return { store, getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
}
const MIN = 60000;

test("config: только mode:true + непустой instanceId", () => {
  assert.deepStrictEqual(LLCLOUD.config({ LL_CLOUD: { mode: true, instanceId: "abc" } }), { instanceId: "abc" });
  assert.strictEqual(LLCLOUD.config({ LL_CLOUD: { mode: false, instanceId: "abc" } }), null);
  assert.strictEqual(LLCLOUD.config({ LL_CLOUD: { mode: true, instanceId: "" } }), null);
  assert.strictEqual(LLCLOUD.config({}), null);
  assert.strictEqual(LLCLOUD.config(null), null);
});

test("clientIdFor: cloud → cloud:<id>, иначе локальный id", () => {
  assert.strictEqual(LLCLOUD.clientIdFor({ instanceId: "abc" }, "local-1"), "cloud:abc");
  assert.strictEqual(LLCLOUD.clientIdFor(null, "local-1"), "local-1");
});

test("detectState: страница логина → logged_out независимо от FindLoads", () => {
  assert.strictEqual(LLCLOUD.detectState({ hostname: "login.dat.com", lastFindLoadsAt: 1000, now: 1000, intervalMs: MIN }), "logged_out");
});

test("detectState: FindLoads в пределах 3 интервалов → ok, дольше → stale, никогда → stale", () => {
  const now = 10 * MIN;
  assert.strictEqual(LLCLOUD.detectState({ hostname: "one.dat.com", lastFindLoadsAt: now - 2 * MIN, now, intervalMs: MIN }), "ok");
  assert.strictEqual(LLCLOUD.detectState({ hostname: "one.dat.com", lastFindLoadsAt: now - 3 * MIN, now, intervalMs: MIN }), "ok");
  assert.strictEqual(LLCLOUD.detectState({ hostname: "one.dat.com", lastFindLoadsAt: now - 3 * MIN - 1, now, intervalMs: MIN }), "stale");
  assert.strictEqual(LLCLOUD.detectState({ hostname: "one.dat.com", lastFindLoadsAt: null, now, intervalMs: MIN }), "stale");
});

test("detectState: интервал меньше 60с поднимается до 60с (как в авто-пилоте)", () => {
  const now = 10 * MIN;
  assert.strictEqual(LLCLOUD.detectState({ hostname: "one.dat.com", lastFindLoadsAt: now - 2.5 * MIN, now, intervalMs: 1000 }), "ok");
});

test("heartbeat: собирает payload, loadsSeen не отрицательный и целый", () => {
  const now = 10 * MIN;
  assert.deepStrictEqual(
    LLCLOUD.heartbeat({ hostname: "one.dat.com", lastFindLoadsAt: now - MIN, now, intervalMs: MIN, loadsSeen: 12.7 }),
    { state: "ok", loadsSeen: 12, lastFindLoadsAt: now - MIN },
  );
  assert.deepStrictEqual(
    LLCLOUD.heartbeat({ hostname: "login.dat.com", lastFindLoadsAt: null, now, intervalMs: MIN, loadsSeen: -3 }),
    { state: "logged_out", loadsSeen: 0, lastFindLoadsAt: null },
  );
});

test("markFindLoads/lastFindLoads: метка переживает reload через sessionStorage", () => {
  const ss = fakeSS();
  assert.strictEqual(LLCLOUD.lastFindLoads(ss), null);
  LLCLOUD.markFindLoads(ss, 12345);
  assert.strictEqual(LLCLOUD.lastFindLoads(ss), 12345);
  assert.strictEqual(LLCLOUD.lastFindLoads(null), null);
  assert.doesNotThrow(() => LLCLOUD.markFindLoads(null, 1));
});

test("due: первый heartbeat — сразу; повтор — через HEARTBEAT_MS; смена состояния — сразу", () => {
  const ss = fakeSS();
  assert.strictEqual(LLCLOUD.due(ss, 1000, "ok"), true);
  LLCLOUD.markHeartbeat(ss, 1000, "ok");
  assert.strictEqual(LLCLOUD.due(ss, 1000 + LLCLOUD.HEARTBEAT_MS - 1, "ok"), false);
  assert.strictEqual(LLCLOUD.due(ss, 1000 + LLCLOUD.HEARTBEAT_MS, "ok"), true);
  assert.strictEqual(LLCLOUD.due(ss, 2000, "logged_out"), true); // состояние сменилось → немедленно
  assert.strictEqual(LLCLOUD.due(null, 2000, "ok"), true);       // нет storage → шлём
});
```

- [ ] **Step 3: Запустить — падает** — `node --test extension/cloud.test.js` → `Cannot find module './cloud.js'`.

- [ ] **Step 4: Реализация `extension/cloud.js`**

```js
/* LoadLens cloud mode (LLCLOUD): чистые функции без DOM/сети — тестируются node --test.
   Конфиг приходит из globalThis.LL_CLOUD (cloud.config.js, который пишет контейнер).
   Метки FindLoads/heartbeat живут в sessionStorage: авто-пилот перезагружает вкладку каждые
   60–120 с, поэтому таймеры в памяти не доживают до 5 минут. */
const LLCLOUD = (() => {
  "use strict";
  const HEARTBEAT_MS = 5 * 60 * 1000;   // период heartbeat
  const STALE_INTERVALS = 3;            // FindLoads не было дольше N интервалов авто-пилота → stale
  const K_LFL = "ll_cloud_lfl_at";      // ts последнего FindLoads
  const K_HB = "ll_cloud_hb_at";        // ts последнего отправленного heartbeat
  const K_HB_STATE = "ll_cloud_hb_state";

  function config(g) {
    const c = g && g.LL_CLOUD;
    if (!c || c.mode !== true || typeof c.instanceId !== "string" || !c.instanceId) return null;
    return { instanceId: c.instanceId };
  }
  function clientIdFor(cfg, localId) { return cfg ? `cloud:${cfg.instanceId}` : localId; }

  function detectState({ hostname, lastFindLoadsAt, now, intervalMs }) {
    if (/^login\./i.test(String(hostname || ""))) return "logged_out";
    const iv = Math.max(60000, Number(intervalMs) || 60000);
    if (!lastFindLoadsAt || now - lastFindLoadsAt > STALE_INTERVALS * iv) return "stale";
    return "ok";
  }
  function heartbeat({ hostname, lastFindLoadsAt, now, intervalMs, loadsSeen }) {
    return {
      state: detectState({ hostname, lastFindLoadsAt, now, intervalMs }),
      loadsSeen: Math.max(0, Math.floor(Number(loadsSeen) || 0)),
      lastFindLoadsAt: lastFindLoadsAt || null,
    };
  }

  function readNum(ss, k) { try { const v = ss ? ss.getItem(k) : null; const n = Number(v); return v && n > 0 ? n : null; } catch (_) { return null; } }
  function write(ss, k, v) { try { if (ss) ss.setItem(k, String(v)); } catch (_) { /* приватный режим/квота */ } }
  function readStr(ss, k) { try { return ss ? ss.getItem(k) : null; } catch (_) { return null; } }

  const markFindLoads = (ss, now) => write(ss, K_LFL, now);
  const lastFindLoads = (ss) => readNum(ss, K_LFL);
  function markHeartbeat(ss, now, state) { write(ss, K_HB, now); write(ss, K_HB_STATE, state); }
  function due(ss, now, state) {
    const last = readNum(ss, K_HB);
    if (!last) return true;
    if (readStr(ss, K_HB_STATE) !== state) return true;
    return now - last >= HEARTBEAT_MS;
  }

  return { HEARTBEAT_MS, STALE_INTERVALS, config, clientIdFor, detectState, heartbeat,
           markFindLoads, lastFindLoads, markHeartbeat, due };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLCLOUD; }
if (typeof globalThis !== "undefined") globalThis.LLCLOUD = LLCLOUD;
```

- [ ] **Step 5: Запустить — проходит** — `node --test extension/cloud.test.js` → все `ok`.

- [ ] **Step 6: Коммит**

```bash
git add extension/cloud.config.js extension/cloud.js extension/cloud.test.js
git commit -m "feat(extension): LLCLOUD — чистая логика cloud mode (state, heartbeat, метки)"
```

---

### Task 3: `LLAPI` — cloud-вызовы, `clientId` с префиксом `cloud:`, `cloudEnabled` в `getMe`

**Files:**
- Modify: `extension/api.js` (`clientId`, `getMe`, новые функции, экспорт), `extension/api.test.js`

**Interfaces:**
- Consumes: `LLCLOUD.config/clientIdFor` (Task 2; `api.js` грузится ПОСЛЕ `cloud.js` — см. manifest в Task 4).
- Produces: `LLAPI.clientId() → 'cloud:<id>'` в облаке; `LLAPI.getMe() → {email, plan, cloudEnabled}`; `LLAPI.cloudStatus() → {enabled, status, lastHeartbeatAt, loadsSeen, screenDomain}|null`; `LLAPI.cloudEnable()`, `LLAPI.cloudDisable()` → тот же объект статуса, бросают `Error(message)`; `LLAPI.cloudScreen() → {url, password}`; `LLAPI.cloudHeartbeat(hb) → void` (тихо глотает ошибки).

- [ ] **Step 1: Тесты в `extension/api.test.js`** (в конец файла)

```js
// ---- cloud mode ----
function fakeChrome(store) {
  return { storage: { local: {
    get: async (k) => { const keys = Array.isArray(k) ? k : [k]; const o = {}; for (const x of keys) if (x in store) o[x] = store[x]; return o; },
    set: async (o) => { Object.assign(store, o); },
    remove: async (k) => { delete store[k]; },
  } } };
}

test("clientId: в cloud mode — cloud:<instanceId>, ll_cid не создаётся", async () => {
  const store = {};
  globalThis.chrome = fakeChrome(store);
  globalThis.LLCLOUD = require("./cloud.js");
  globalThis.LL_CLOUD = { mode: true, instanceId: "inst-1" };
  assert.strictEqual(await LLAPI.clientId(), "cloud:inst-1");
  assert.strictEqual(store.ll_cid, undefined);
  delete globalThis.LL_CLOUD;
  const id = await LLAPI.clientId();
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.strictEqual(store.ll_cid, id);
});

test("getMe: кэш из ll_auth отдаёт cloudEnabled", async () => {
  const store = { ll_auth: { accessToken: "a", refreshToken: "r", email: "x@y.z", plan: "pro", cloudEnabled: true, planTs: Date.now() } };
  globalThis.chrome = fakeChrome(store);
  assert.deepStrictEqual(await LLAPI.getMe(), { email: "x@y.z", plan: "pro", cloudEnabled: true });
});

test("cloudHeartbeat: без логина и при сетевой ошибке не бросает", async () => {
  globalThis.chrome = fakeChrome({});
  await assert.doesNotReject(LLAPI.cloudHeartbeat({ state: "ok", loadsSeen: 1, lastFindLoadsAt: 1 }));
  globalThis.chrome = fakeChrome({ ll_auth: { accessToken: "a", refreshToken: "r" } });
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try { await assert.doesNotReject(LLAPI.cloudHeartbeat({ state: "ok", loadsSeen: 1, lastFindLoadsAt: 1 })); }
  finally { globalThis.fetch = origFetch; }
});
```

- [ ] **Step 2: Запустить — падает** — `node --test extension/api.test.js`: `clientId` вернёт uuid вместо `cloud:inst-1`, `getMe` без `cloudEnabled`, `cloudHeartbeat is not a function`.

- [ ] **Step 3: Реализация в `extension/api.js`**

`clientId`:
```js
  // В облачном контейнере устройство = инстанс: cloud:<instanceId> (бэкенд не считает его в лимит).
  async function clientId() {
    const cloud = (typeof LLCLOUD !== "undefined") ? LLCLOUD.config(globalThis) : null;
    if (cloud) return LLCLOUD.clientIdFor(cloud, null);
    const { ll_cid } = await chrome.storage.local.get("ll_cid");
    if (ll_cid) return ll_cid;
    const id = crypto.randomUUID();
    await chrome.storage.local.set({ ll_cid: id });
    return id;
  }
```

`getMe` — обе ветки возврата из кэша и запись кэша:
```js
    if (!force && auth.planTs && Date.now() - auth.planTs < PLAN_TTL)
      return { email: auth.email, plan: auth.plan, cloudEnabled: !!auth.cloudEnabled };
    …
      if (!res.ok) return { email: auth.email, plan: auth.plan, cloudEnabled: !!auth.cloudEnabled };
      const user = await res.json();
      await setAuth({ ...auth, email: user.email, plan: user.plan, cloudEnabled: !!user.cloudEnabled, planTs: Date.now() });
      return { email: user.email, plan: user.plan, cloudEnabled: !!user.cloudEnabled };
    } catch { return { email: auth.email, plan: auth.plan, cloudEnabled: !!auth.cloudEnabled }; }
```

Новые функции (перед `return {`):
```js
  // ---- Cloud browser (под JWT; cloud_enabled проверяет сервер) ----
  async function cloudCall(path, opts) {
    const res = await authedFetch(path, opts);
    if (!res) throw new Error("sign in required");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `error ${res.status}`);
    return data;
  }
  async function cloudStatus() {
    try { const res = await authedFetch("/cloud/status"); return res && res.ok ? await res.json() : null; }
    catch { return null; }
  }
  const cloudEnable = () => cloudCall("/cloud/enable", { method: "POST" });
  const cloudDisable = () => cloudCall("/cloud/disable", { method: "POST" });
  const cloudScreen = () => cloudCall("/cloud/screen", { method: "POST" }); // { url, password }
  // Heartbeat из облачного браузера — фоновый канал, ошибки глотаем.
  async function cloudHeartbeat(hb) {
    try { await authedFetch("/cloud/heartbeat", { method: "POST", body: JSON.stringify(hb) }); } catch { /* фон */ }
  }
```
и добавить в `return { … telegramUnlink, notifyAlerts, cloudStatus, cloudEnable, cloudDisable, cloudScreen, cloudHeartbeat };`.

- [ ] **Step 4: Запустить — проходит** — `node --test extension/api.test.js`.

- [ ] **Step 5: Коммит**

```bash
git add extension/api.js extension/api.test.js
git commit -m "feat(extension): LLAPI — cloud-вызовы, clientId cloud:<id>, cloudEnabled в getMe"
```

---

### Task 4: `content.js` cloud mode — форс авто-пилота, heartbeat, manifest

**Files:**
- Modify: `extension/manifest.json` (content_scripts js), `extension/popup.html` (script-теги), `extension/content.js` (стейт, boot, onChanged, панель, message-listener)

**Interfaces:**
- Consumes: `LLCLOUD.*` (Task 2), `LLAPI.cloudHeartbeat` (Task 3).
- Produces: в cloud mode `autoRefresh.on === true` всегда; heartbeat раз в 5 мин / при смене состояния.

- [ ] **Step 1: manifest.json** — в `content_scripts[0].js` первым элементом добавить `"cloud.config.js"`, затем сразу после него `"cloud.js"` (оба ДО `vendor/load.model.js`, чтобы `api.js` уже видел `LLCLOUD`/`LL_CLOUD`). В `popup.html` перед `<script src="api.js">` добавить `<script src="cloud.config.js"></script>` и `<script src="cloud.js"></script>`.

- [ ] **Step 2: content.js — стейт** (рядом с `let pendingSortReapply = false;`):

```js
  let cloudCfg = null;           // cloud mode (LLCLOUD.config) — авто-пилот всегда ВКЛ, heartbeat на бэкенд
  const HEARTBEAT_TICK_MS = 60000; // проверка «пора ли heartbeat» (сам период — LLCLOUD.HEARTBEAT_MS)
```

- [ ] **Step 3: content.js — boot** — сразу после блока, где вычисляется `autoRefresh = {…}` (внутри `try`), добавить:

```js
      // Cloud mode: авто-пилот форсим независимо от попапа/per-tab override (спека §4).
      cloudCfg = (typeof LLCLOUD !== "undefined") ? LLCLOUD.config(globalThis) : null;
      if (cloudCfg) autoRefresh.on = true;
```

В `chrome.storage.onChanged` в ветке `if (on !== !!(prev && prev.on)) {` заменить `autoRefresh.on = on;` на `autoRefresh.on = cloudCfg ? true : on;`.

- [ ] **Step 4: content.js — панель** — строку с чекбоксом заменить на:

```js
        `<label title="${cloudCfg ? "Cloud mode: auto-pilot is always on in the cloud browser" : ""}"><input type="checkbox" id="ll-ar"${autoRefresh.on ? " checked" : ""}${cloudCfg ? " disabled" : ""}> Auto-refresh${cloudCfg ? " (Cloud)" : ""}</label> ` +
```
В обработчике `if (ar) ar.onchange = () => {` первой строкой добавить `if (cloudCfg) { ar.checked = true; return; }`.

- [ ] **Step 5: content.js — heartbeat** — в message-listener после `const res = DAT_GQL.parseFindLoadsResult(d.payload);` добавить (до `if (res.loads.length)`; метка ставится на любой ответ FindLoads, пустая выдача — не «stale»):

```js
        if (cloudCfg) LLCLOUD.markFindLoads(sessionStorage, Date.now());
```

Перед `render();` в конце `boot()` добавить:

```js
    // Cloud mode: heartbeat на бэкенд (раз в 5 мин или при смене состояния). Метки — в sessionStorage,
    // т.к. авто-пилот перезагружает вкладку каждые 60–120 с и таймеры в памяти не доживают.
    if (cloudCfg && typeof LLAPI !== "undefined") {
      const tick = async () => {
        const now = Date.now();
        const hb = LLCLOUD.heartbeat({
          hostname: location.hostname, lastFindLoadsAt: LLCLOUD.lastFindLoads(sessionStorage),
          now, intervalMs: autoRefresh.intervalMs, loadsSeen: gqlLoads.length,
        });
        if (!LLCLOUD.due(sessionStorage, now, hb.state)) return;
        LLCLOUD.markHeartbeat(sessionStorage, now, hb.state);
        await LLAPI.cloudHeartbeat(hb);
      };
      // первый тик с задержкой: DAT ещё восстанавливает поиск после reload; на странице логина — сразу
      setTimeout(tick, /^login\./i.test(location.hostname) ? 0 : 20000);
      setInterval(tick, HEARTBEAT_TICK_MS);
    }
```

- [ ] **Step 6: Прогнать тесты и проверку языка** — `npm test` в корне (sync:shared, check:lang, все тесты) → зелено.

- [ ] **Step 7: Ручная проверка в Chrome** — `chrome://extensions` → перезагрузить распакованное `extension/`; открыть DAT → панель как раньше (чекбокс активен, без «(Cloud)»). Затем временно записать в `extension/cloud.config.js` строку `globalThis.LL_CLOUD = { mode: true, instanceId: "dev" };`, перезагрузить → чекбокс `Auto-refresh (Cloud)` заблокирован и включён; в DevTools → Network через ~20 с виден `POST /api/v1/cloud/heartbeat` (403 до Task 7 — нормально). **Вернуть заглушку** (`git checkout extension/cloud.config.js`).

- [ ] **Step 8: Коммит**

```bash
git add extension/manifest.json extension/popup.html extension/content.js
git commit -m "feat(extension): cloud mode — форс авто-пилота, heartbeat, подключение cloud.js"
```

---

### Task 5: Backend — модель `cloud_instances`, `users.cloud_enabled`, `/auth/me`

**Files:**
- Create: `backend/src/cloud/cloud-instance.model.ts`
- Modify: `backend/src/users/user.model.ts`, `backend/src/main.ts`, `backend/src/app.module.ts`, `backend/src/auth/auth.service.ts`, `backend/src/auth/auth.service.spec.ts`

**Interfaces:**
- Produces: `CloudInstance` (поля ниже), `User.cloudEnabled: boolean`, `/auth/me` → `{email, plan, cloudEnabled}`, тип `CloudStatus`.

- [ ] **Step 1: Тест `/auth/me` в `auth.service.spec.ts`** — найти существующий describe для `me` (или добавить рядом с тестами `login`) — по образцу моков файла:

```ts
  it('me: отдаёт cloudEnabled', async () => {
    await service.register('a@b.c', 'password123', null);
    users['a@b.c'].cloudEnabled = true;
    await expect(service.me(users['a@b.c'].id)).resolves.toEqual({ email: 'a@b.c', plan: 'free', cloudEnabled: true });
  });
```
(В этом spec-файле `service` и карта `users` создаются в `beforeEach`; `findByPk` мока ищет по `id` — проверить, что мок `userModel.findByPk` есть, иначе добавить `findByPk: jest.fn((id) => Promise.resolve(Object.values(users).find((u: any) => u.id === id) ?? null))`.)

- [ ] **Step 2: Запустить — падает** — `cd backend && npx jest auth.service` → `cloudEnabled` отсутствует.

- [ ] **Step 3: Модель `backend/src/cloud/cloud-instance.model.ts`**

```ts
import { Column, DataType, Model, Table } from 'sequelize-typescript';

export type CloudStatus = 'starting' | 'ok' | 'logged_out' | 'stale' | 'stopped' | 'error';
export const CLOUD_STATUSES: CloudStatus[] = ['starting', 'ok', 'logged_out', 'stale', 'stopped', 'error'];

// Один облачный браузер на пользователя (unique user_id). Coolify Service хранит контейнер и volume;
// здесь — связка user → service, статус по heartbeat/watchdog и пароль экрана.
@Table({ tableName: 'cloud_instances', underscored: true, timestamps: true })
export class CloudInstance extends Model {
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4, primaryKey: true })
  id: string;

  @Column({
    type: DataType.UUID, allowNull: false, unique: true, field: 'user_id',
    references: { model: 'users', key: 'id' }, onDelete: 'CASCADE',
  })
  userId: string;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'coolify_service_uuid' })
  coolifyServiceUuid: string | null;

  // FQDN экрана, который Coolify выдал сервису (SERVICE_FQDN_BROWSER_6080), без схемы
  @Column({ type: DataType.TEXT, allowNull: true, field: 'screen_domain' })
  screenDomain: string | null;

  // Пароль noVNC: генерим сами, в контейнер уходит через Coolify env NOVNC_PASSWORD. Ротация на Enable.
  @Column({ type: DataType.TEXT, allowNull: true, field: 'vnc_password' })
  vncPassword: string | null;

  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: 'starting' })
  status: CloudStatus;

  @Column({ type: DataType.DATE, allowNull: true, field: 'last_heartbeat_at' })
  lastHeartbeatAt: Date | null;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0, field: 'loads_seen' })
  loadsSeen: number;

  // Последний статус, о котором пользователю ушёл DM (чтобы слать один раз на смену статуса)
  @Column({ type: DataType.TEXT, allowNull: true, field: 'last_state_notified' })
  lastStateNotified: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'disabled_at' })
  disabledAt: Date | null;
}
```

- [ ] **Step 4: `user.model.ts`** — после `deviceEvictions`:

```ts
  // Cloud browser (Pro Cloud): включает админ. Без флага /cloud/* отвечает 403.
  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'cloud_enabled' })
  cloudEnabled: boolean;
```

`main.ts` — после строки с `device_evictions`:
```ts
  await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS cloud_enabled BOOLEAN NOT NULL DEFAULT false');
```

`app.module.ts` — импорт `CloudInstance` из `./cloud/cloud-instance.model` и добавить в `models: [ …, AlertSend, CloudInstance ]` (таблица новая — `synchronize` создаст её сам).

- [ ] **Step 5: `auth.service.ts`** — `publicUser`:

```ts
  private publicUser(u: User) { return { email: u.email, plan: u.plan, cloudEnabled: !!u.cloudEnabled }; }
```
(метод `me` использует `publicUser` — проверить; если возвращает объект напрямую, добавить `cloudEnabled: !!user.cloudEnabled` там.)

- [ ] **Step 6: Запустить — проходит** — `cd backend && npm run build && npm test`.

- [ ] **Step 7: Коммит**

```bash
git add backend/src/cloud/cloud-instance.model.ts backend/src/users/user.model.ts backend/src/main.ts backend/src/app.module.ts backend/src/auth/auth.service.ts backend/src/auth/auth.service.spec.ts
git commit -m "feat(backend): модель cloud_instances, users.cloud_enabled, cloudEnabled в /auth/me"
```

---

### Task 6: Backend — `CoolifyService` (клиент API) + `renderCompose`

**Files:**
- Create: `docs/research/2026-09-13-coolify-services-api.md` (факты с живого API), `backend/src/cloud/coolify.service.ts`, `backend/src/cloud/coolify.service.spec.ts`

**Interfaces:**
- Produces: `renderCompose({userId, instanceId, imageTag}) → string` (YAML); `CoolifyService.configured: boolean`; `createService({name, compose}) → Promise<{uuid: string}>`; `setEnv(uuid, key, value) → Promise<void>`; `start(uuid)`, `stop(uuid)`, `restart(uuid)` → `Promise<void>`; `deleteService(uuid, {deleteVolumes: true}) → Promise<void>`; `getFqdn(uuid) → Promise<string|null>` (без схемы); `CoolifyError extends Error` с `status`.

- [ ] **Step 1: Ручная проверка API (нужен токен Coolify write+deploy — создаёт владелец в UI: Keys & Tokens → API tokens, права `read`+`write`+`deploy`, имя `loadlens-backend`; токен положить только в `backend/.env` как `COOLIFY_API_TOKEN`, не коммитить).** Из ssh на 46.4.25.36 (или через туннель к :8000) выполнить и записать ответы (без токена) в `docs/research/2026-09-13-coolify-services-api.md`:

```bash
export T=<token>; export B=http://127.0.0.1:8000/api/v1
curl -s -H "Authorization: Bearer $T" $B/version
# 1) create (instant_deploy=false): фиксируем форму ответа ({uuid, domains?})
COMPOSE=$(printf '%s' "$(cat <<'YAML'
services:
  browser:
    image: ghcr.io/bogbuk/loadlens-cloud-browser:latest
    hostname: ll-manual
    environment:
      - SERVICE_FQDN_BROWSER_6080
      - NOVNC_PASSWORD=${NOVNC_PASSWORD}
      - START_URL=https://one.dat.com/search-loads
      - SCREEN=1440x900x24
      - LL_INSTANCE_ID=manual-1
    volumes:
      - profile:/data
    shm_size: 512m
    mem_limit: 2g
    cpus: 1
    pids_limit: 512
    restart: unless-stopped
volumes:
  profile:
YAML
)" | base64 | tr -d '\n')
curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" $B/services -d "{\"type\":\"docker-compose-empty\",\"name\":\"ll-manual\",\"server_uuid\":\"f8xhhqagybtdjk14krvrp0kq\",\"project_uuid\":\"ocls09doyppd1f5ze0fsjj8r\",\"environment_name\":\"production\",\"docker_compose_raw\":\"$COMPOSE\",\"instant_deploy\":false}"
# 2) envs: как задать NOVNC_PASSWORD; 3) GET /services/{uuid}: где FQDN; 4) start; 5) docker inspect
curl -s -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" $B/services/<uuid>/envs -d '{"key":"NOVNC_PASSWORD","value":"manual-pass-1","is_preview":false}'
curl -s -H "Authorization: Bearer $T" $B/services/<uuid> | head -c 3000
curl -s -X POST -H "Authorization: Bearer $T" $B/services/<uuid>/start
docker ps --filter name=browser | head; docker inspect <container> --format 'mem={{.HostConfig.Memory}} shm={{.HostConfig.ShmSize}} pids={{.HostConfig.PidsLimit}} host={{.Config.Hostname}}'
# 6) stop, delete с volume
curl -s -X POST -H "Authorization: Bearer $T" $B/services/<uuid>/stop
curl -s -X DELETE -H "Authorization: Bearer $T" "$B/services/<uuid>?delete_volumes=true"
```

Записать в research-файл: точный `type` (если `docker-compose-empty` не принят — какой принят), форму ответа create, путь к FQDN в `GET /services/{uuid}` (ожидаемо `applications[0].fqdn`), метод/поля envs, результат `docker inspect` (пережили ли `mem_limit`/`shm_size`/`pids_limit`/`hostname` парсер Coolify — риск №6 спеки). **Предусловие для FQDN:** в Coolify UI у сервера `localhost` задан Wildcard Domain `https://cloud.loadlens.krait.studio` (DNS — Task 13, шаг 2; сделать до этого шага). Если реальные пути отличаются от Step 3 ниже — править Step 3 по фактам, а не наоборот.

- [ ] **Step 2: Тесты `coolify.service.spec.ts`**

```ts
import { CoolifyService, renderCompose, CoolifyError } from './coolify.service';

describe('renderCompose', () => {
  const yaml = renderCompose({ userId: '123e4567-e89b-12d3-a456-426614174000', instanceId: 'inst-1', imageTag: 'sha-abc' });
  it('образ с тегом, фиксированный hostname, LL_INSTANCE_ID, лимиты', () => {
    expect(yaml).toContain('image: ghcr.io/bogbuk/loadlens-cloud-browser:sha-abc');
    expect(yaml).toContain('hostname: ll-123e4567');
    expect(yaml).toContain('LL_INSTANCE_ID=inst-1');
    expect(yaml).toContain('SERVICE_FQDN_BROWSER_6080');
    expect(yaml).toContain('NOVNC_PASSWORD=${NOVNC_PASSWORD}');
    expect(yaml).toContain('mem_limit: 2g');
    expect(yaml).toContain('shm_size: 512m');
    expect(yaml).toContain('pids_limit: 512');
    expect(yaml).toContain('START_URL=https://one.dat.com/search-loads');
    expect(yaml).not.toContain('ports:');
  });
});

function makeService(responses: Array<{ status: number; body: any }>) {
  process.env.COOLIFY_API_URL = 'http://coolify.test';
  process.env.COOLIFY_API_TOKEN = 'tok';
  process.env.COOLIFY_CLOUD_SERVER_UUID = 'srv';
  process.env.COOLIFY_CLOUD_PROJECT_UUID = 'prj';
  const calls: Array<{ method: string; url: string; body?: any }> = [];
  const fetchFn = jest.fn().mockImplementation(async (url: string, init: any) => {
    calls.push({ method: init.method, url, body: init.body ? JSON.parse(init.body) : undefined });
    const r = responses.shift() || { status: 200, body: {} };
    return { ok: r.status < 400, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) };
  });
  return { svc: new CoolifyService(fetchFn as any), calls };
}

describe('CoolifyService', () => {
  afterEach(() => { delete process.env.COOLIFY_API_URL; });

  it('configured=false без COOLIFY_API_URL; вызовы бросают CoolifyError', async () => {
    const { svc } = makeService([]);
    delete process.env.COOLIFY_API_URL;
    expect(svc.configured).toBe(false);
    await expect(svc.start('u')).rejects.toBeInstanceOf(CoolifyError);
  });

  it('createService: POST /services с base64 compose, server/project из env, instant_deploy=false → uuid', async () => {
    const { svc, calls } = makeService([{ status: 201, body: { uuid: 'svc-1', domains: [] } }]);
    const r = await svc.createService({ name: 'll-abc', compose: 'services: {}' });
    expect(r).toEqual({ uuid: 'svc-1' });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('http://coolify.test/api/v1/services');
    expect(calls[0].body.server_uuid).toBe('srv');
    expect(calls[0].body.project_uuid).toBe('prj');
    expect(calls[0].body.environment_name).toBe('production');
    expect(calls[0].body.instant_deploy).toBe(false);
    expect(Buffer.from(calls[0].body.docker_compose_raw, 'base64').toString()).toBe('services: {}');
  });

  it('setEnv/start/stop/restart/deleteService — правильные пути и методы', async () => {
    const { svc, calls } = makeService([]);
    await svc.setEnv('s', 'NOVNC_PASSWORD', 'p');
    await svc.start('s'); await svc.stop('s'); await svc.restart('s');
    await svc.deleteService('s', { deleteVolumes: true });
    expect(calls.map((c) => `${c.method} ${c.url.replace('http://coolify.test/api/v1', '')}`)).toEqual([
      'POST /services/s/envs', 'POST /services/s/start', 'POST /services/s/stop', 'POST /services/s/restart',
      'DELETE /services/s?delete_volumes=true',
    ]);
    expect(calls[0].body).toEqual({ key: 'NOVNC_PASSWORD', value: 'p', is_preview: false });
  });

  it('getFqdn: берёт fqdn первого приложения сервиса без схемы; нет → null', async () => {
    const { svc } = makeService([
      { status: 200, body: { applications: [{ fqdn: 'https://browser-x.cloud.loadlens.krait.studio' }] } },
      { status: 200, body: { applications: [] } },
    ]);
    expect(await svc.getFqdn('s')).toBe('browser-x.cloud.loadlens.krait.studio');
    expect(await svc.getFqdn('s')).toBeNull();
  });

  it('ошибка HTTP → CoolifyError со статусом', async () => {
    const { svc } = makeService([{ status: 422, body: { message: 'bad' } }]);
    await expect(svc.start('s')).rejects.toMatchObject({ status: 422 });
  });
});
```

- [ ] **Step 3: Запустить — падает** — `cd backend && npx jest coolify` → модуль не найден.

- [ ] **Step 4: Реализация `coolify.service.ts`**

```ts
import { Inject, Injectable, Optional } from '@nestjs/common';

// Coolify — единственный оркестратор контейнеров тенантов (спека §2). Никакого Docker API напрямую.
// Проверено вручную 2026-09-13 — docs/research/2026-09-13-coolify-services-api.md.

export const COOLIFY_FETCH = 'COOLIFY_FETCH';
export const CLOUD_IMAGE = 'ghcr.io/bogbuk/loadlens-cloud-browser';

export class CoolifyError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

// Compose одного тенанта (спека §2). Лимиты — только здесь: UI-лимиты Coolify на compose не действуют.
export function renderCompose(p: { userId: string; instanceId: string; imageTag: string }): string {
  const host = `ll-${p.userId.slice(0, 8)}`;
  return [
    'services:',
    '  browser:',
    `    image: ${CLOUD_IMAGE}:${p.imageTag}`,
    `    hostname: ${host}`,
    '    environment:',
    '      - SERVICE_FQDN_BROWSER_6080',
    '      - NOVNC_PASSWORD=${NOVNC_PASSWORD}',
    '      - START_URL=https://one.dat.com/search-loads',
    '      - SCREEN=1440x900x24',
    `      - LL_INSTANCE_ID=${p.instanceId}`,
    '    volumes:',
    '      - profile:/data',
    '    shm_size: 512m',
    '    mem_limit: 2g',
    '    cpus: 1',
    '    pids_limit: 512',
    '    restart: unless-stopped',
    'volumes:',
    '  profile:',
    '',
  ].join('\n');
}

@Injectable()
export class CoolifyService {
  constructor(@Optional() @Inject(COOLIFY_FETCH) private readonly fetchFn: typeof fetch = globalThis.fetch) {}

  get configured(): boolean { return !!process.env.COOLIFY_API_URL; }

  private async request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.configured) throw new CoolifyError('cloud is not configured', 503);
    const res = await this.fetchFn(`${process.env.COOLIFY_API_URL}/api/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.COOLIFY_API_TOKEN || ''}`,
        'Content-Type': 'application/json', Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new CoolifyError(`coolify ${method} ${path} → ${res.status} ${text.slice(0, 200)}`, res.status);
    }
    return res.json().catch(() => ({})) as Promise<T>;
  }

  async createService(p: { name: string; compose: string }): Promise<{ uuid: string }> {
    const r = await this.request<{ uuid: string }>('POST', '/services', {
      type: 'docker-compose-empty',
      name: p.name,
      server_uuid: process.env.COOLIFY_CLOUD_SERVER_UUID,
      project_uuid: process.env.COOLIFY_CLOUD_PROJECT_UUID,
      environment_name: process.env.COOLIFY_CLOUD_ENV_NAME || 'production',
      docker_compose_raw: Buffer.from(p.compose).toString('base64'),
      instant_deploy: false, // сначала env NOVNC_PASSWORD, потом start
    });
    return { uuid: r.uuid };
  }
  setEnv(uuid: string, key: string, value: string): Promise<void> {
    return this.request('POST', `/services/${uuid}/envs`, { key, value, is_preview: false });
  }
  start(uuid: string): Promise<void> { return this.request('POST', `/services/${uuid}/start`); }
  stop(uuid: string): Promise<void> { return this.request('POST', `/services/${uuid}/stop`); }
  restart(uuid: string): Promise<void> { return this.request('POST', `/services/${uuid}/restart`); }
  deleteService(uuid: string, o: { deleteVolumes: boolean }): Promise<void> {
    return this.request('DELETE', `/services/${uuid}?delete_volumes=${o.deleteVolumes}`);
  }
  // FQDN экрана, выданный Coolify по SERVICE_FQDN_BROWSER_6080 (после первого деплоя). Без схемы.
  async getFqdn(uuid: string): Promise<string | null> {
    const s = await this.request<{ applications?: Array<{ fqdn?: string | null }> }>('GET', `/services/${uuid}`);
    const fqdn = s.applications?.[0]?.fqdn || null;
    return fqdn ? fqdn.replace(/^https?:\/\//, '').split(',')[0].trim() : null;
  }
}
```
**Если Step 1 показал другие пути/поля (например, `type`, форма envs или место FQDN) — привести код и тест к фактам.**

- [ ] **Step 5: Запустить — проходит** — `cd backend && npx jest coolify`.

- [ ] **Step 6: Коммит**

```bash
git add docs/research/2026-09-13-coolify-services-api.md backend/src/cloud/coolify.service.ts backend/src/cloud/coolify.service.spec.ts
git commit -m "feat(backend): CoolifyService — клиент API + compose тенанта"
```

---

### Task 7: Backend — `CloudService`, `CloudGuard`, `CloudController`, `CloudModule`

**Files:**
- Create: `backend/src/cloud/cloud.service.ts`, `cloud.service.spec.ts`, `cloud.guard.ts`, `cloud.controller.ts`, `cloud.module.ts`, `dto/heartbeat.dto.ts`
- Modify: `backend/src/app.module.ts` (импорт `CloudModule`), `backend/package.json` (`@nestjs/schedule` — ставится здесь, используется в Task 8)

**Interfaces:**
- Consumes: `CoolifyService` (Task 6), `CloudInstance` (Task 5), `TelegramService.sendMessageTo` (существует).
- Produces: `CloudService.status(userId) → CloudStatusView`; `enable(userId)`, `disable(userId)` → `CloudStatusView`; `screen(userId) → {url, password}`; `heartbeat(userId, dto) → {ok: true}`; `disableForUser(userId) → void` (для админки, no-op без инстанса); `screenUrl(inst) → string|null`. `CloudStatusView = { enabled: true, status: CloudStatus|'off', lastHeartbeatAt: string|null, loadsSeen: number, screenDomain: string|null }`.

- [ ] **Step 1: Зависимость** — `cd backend && npm install @nestjs/schedule@^4` (совместим с Nest 10; проверить `npm ls @nestjs/schedule`).

- [ ] **Step 2: Тесты `cloud.service.spec.ts`**

```ts
import { ServiceUnavailableException } from '@nestjs/common';
import { CloudService } from './cloud.service';

function makeService(opts: { inst?: any; configured?: boolean; fqdn?: string | null } = {}) {
  process.env.CLOUD_IMAGE_TAG = 'latest';
  let inst = opts.inst === undefined ? null : opts.inst;
  const saved: any[] = [];
  const instances = {
    findOne: jest.fn().mockImplementation(async () => inst),
    create: jest.fn().mockImplementation(async (data) => {
      inst = { id: 'inst-1', loadsSeen: 0, ...data, save: async function () { saved.push({ ...this }); } };
      return inst;
    }),
  };
  if (inst) inst.save = async function () { saved.push({ ...this }); };
  const coolify = {
    configured: opts.configured !== false,
    createService: jest.fn().mockResolvedValue({ uuid: 'svc-1' }),
    setEnv: jest.fn().mockResolvedValue(undefined),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    restart: jest.fn().mockResolvedValue(undefined),
    deleteService: jest.fn().mockResolvedValue(undefined),
    getFqdn: jest.fn().mockResolvedValue(opts.fqdn === undefined ? 'browser-x.cloud.loadlens.krait.studio' : opts.fqdn),
  };
  const users = { findByPk: jest.fn().mockResolvedValue({ id: 'u1', telegramChatId: '42' }) };
  const telegram = { sendMessageTo: jest.fn().mockResolvedValue(true) };
  const svc = new CloudService(instances as any, users as any, coolify as any, telegram as any);
  return { svc, instances, coolify, telegram, saved, get inst() { return inst; } };
}

describe('CloudService.enable', () => {
  it('без COOLIFY_API_URL → 503', async () => {
    const { svc } = makeService({ configured: false });
    await expect(svc.enable('u1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('первый Enable: создаёт строку, сервис в Coolify, env пароля, старт, FQDN; статус starting', async () => {
    const { svc, coolify, instances } = makeService();
    const view = await svc.enable('u1');
    expect(instances.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', status: 'starting' }));
    expect(coolify.createService).toHaveBeenCalledWith(expect.objectContaining({ name: expect.stringMatching(/^ll-/) }));
    const compose = coolify.createService.mock.calls[0][0].compose;
    expect(compose).toContain('LL_INSTANCE_ID=inst-1');
    expect(coolify.setEnv).toHaveBeenCalledWith('svc-1', 'NOVNC_PASSWORD', expect.stringMatching(/^[A-Za-z0-9]{20}$/));
    expect(coolify.start).toHaveBeenCalledWith('svc-1');
    expect(view).toEqual(expect.objectContaining({ enabled: true, status: 'starting', screenDomain: 'browser-x.cloud.loadlens.krait.studio' }));
  });

  it('повторный Enable при живом сервисе — идемпотентен: ничего не создаёт и не стартует', async () => {
    const { svc, coolify, instances } = makeService({ inst: { id: 'inst-1', userId: 'u1', coolifyServiceUuid: 'svc-1', status: 'ok', vncPassword: 'p', screenDomain: 'd' } });
    const view = await svc.enable('u1');
    expect(instances.create).not.toHaveBeenCalled();
    expect(coolify.createService).not.toHaveBeenCalled();
    expect(coolify.start).not.toHaveBeenCalled();
    expect(view.status).toBe('ok');
  });

  it('Enable после Disable: ротирует пароль, стартует существующий сервис, снимает disabledAt', async () => {
    const { svc, coolify, inst } = makeService({ inst: { id: 'inst-1', userId: 'u1', coolifyServiceUuid: 'svc-1', status: 'stopped', vncPassword: 'old', screenDomain: 'd', disabledAt: new Date() } });
    const view = await svc.enable('u1');
    expect(coolify.createService).not.toHaveBeenCalled();
    expect(coolify.setEnv).toHaveBeenCalledWith('svc-1', 'NOVNC_PASSWORD', expect.not.stringMatching(/^old$/));
    expect(coolify.start).toHaveBeenCalledWith('svc-1');
    expect(view.status).toBe('starting');
    expect(inst.disabledAt).toBeNull();
  });

  it('Coolify упал на create → статус error, ошибка пробрасывается как 502', async () => {
    const { svc, coolify, inst } = makeService();
    coolify.createService.mockRejectedValue(new Error('boom'));
    await expect(svc.enable('u1')).rejects.toMatchObject({ status: 502 });
    expect(inst.status).toBe('error');
  });
});

describe('CloudService.disable / status / screen / heartbeat', () => {
  const live = () => ({ id: 'inst-1', userId: 'u1', coolifyServiceUuid: 'svc-1', status: 'ok', vncPassword: 'p', screenDomain: 'd.example', lastHeartbeatAt: new Date('2026-09-13T10:00:00Z'), loadsSeen: 5 });

  it('disable: stop, статус stopped, disabledAt=now; без инстанса — off', async () => {
    const { svc, coolify, inst } = makeService({ inst: live() });
    const view = await svc.disable('u1');
    expect(coolify.stop).toHaveBeenCalledWith('svc-1');
    expect(view.status).toBe('stopped');
    expect(inst.disabledAt).toBeInstanceOf(Date);
    const empty = makeService();
    expect((await empty.svc.disable('u1')).status).toBe('off');
    expect(empty.coolify.stop).not.toHaveBeenCalled();
  });

  it('status: off без строки; иначе статус + heartbeat ISO + loadsSeen + домен', async () => {
    expect(await makeService().svc.status('u1')).toEqual({ enabled: true, status: 'off', lastHeartbeatAt: null, loadsSeen: 0, screenDomain: null });
    expect(await makeService({ inst: live() }).svc.status('u1')).toEqual({
      enabled: true, status: 'ok', lastHeartbeatAt: '2026-09-13T10:00:00.000Z', loadsSeen: 5, screenDomain: 'd.example',
    });
  });

  it('screen: url noVNC с autoconnect и паролем; без домена/остановленный → 409', async () => {
    const { svc } = makeService({ inst: live() });
    expect(await svc.screen('u1')).toEqual({ url: 'https://d.example/vnc.html?autoconnect=1&resize=scale&password=p', password: 'p' });
    await expect(makeService({ inst: { ...live(), status: 'stopped' } }).svc.screen('u1')).rejects.toMatchObject({ status: 409 });
    await expect(makeService({ inst: { ...live(), screenDomain: null } }).svc.screen('u1')).rejects.toMatchObject({ status: 409 });
    await expect(makeService().svc.screen('u1')).rejects.toMatchObject({ status: 409 });
  });

  it('heartbeat: пишет статус/время/loadsSeen; ok сбрасывает lastStateNotified; stopped не оживляет', async () => {
    const { svc, inst } = makeService({ inst: { ...live(), status: 'stale', lastStateNotified: 'stale' } });
    await svc.heartbeat('u1', { state: 'ok', loadsSeen: 40, lastFindLoadsAt: 1 });
    expect(inst.status).toBe('ok'); expect(inst.loadsSeen).toBe(40); expect(inst.lastStateNotified).toBeNull();
    await svc.heartbeat('u1', { state: 'logged_out', loadsSeen: 0, lastFindLoadsAt: null });
    expect(inst.status).toBe('logged_out');
    const stopped = makeService({ inst: { ...live(), status: 'stopped' } });
    await stopped.svc.heartbeat('u1', { state: 'ok', loadsSeen: 1, lastFindLoadsAt: 1 });
    expect(stopped.inst.status).toBe('stopped');
    await expect(makeService().svc.heartbeat('u1', { state: 'ok', loadsSeen: 1, lastFindLoadsAt: 1 })).resolves.toEqual({ ok: true });
  });
});
```

- [ ] **Step 3: Запустить — падает** — `cd backend && npx jest cloud.service` → модуль не найден.

- [ ] **Step 4: `dto/heartbeat.dto.ts`**

```ts
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

export class HeartbeatDto {
  @IsIn(['ok', 'logged_out', 'stale'])
  state: 'ok' | 'logged_out' | 'stale';

  @IsInt() @Min(0)
  loadsSeen: number;

  // epoch ms последнего FindLoads в облачной вкладке (null — не было с последнего reload)
  @IsOptional() @IsInt() @Min(0)
  lastFindLoadsAt?: number | null;
}
```

- [ ] **Step 5: `cloud.service.ts`**

```ts
import {
  BadGatewayException, ConflictException, Injectable, Logger, ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { randomBytes } from 'node:crypto';
import { User } from '../users/user.model';
import { TelegramService } from '../telegram/telegram.service';
import { CloudInstance, CloudStatus } from './cloud-instance.model';
import { CoolifyService, renderCompose } from './coolify.service';
import { HeartbeatDto } from './dto/heartbeat.dto';

export interface CloudStatusView {
  enabled: true;
  status: CloudStatus | 'off';
  lastHeartbeatAt: string | null;
  loadsSeen: number;
  screenDomain: string | null;
}

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
// 20 символов без похожих (0/O, 1/l/I): пароль пользователь может вводить руками в noVNC.
export function randomPassword(len = 20): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  return out;
}

@Injectable()
export class CloudService {
  private readonly log = new Logger(CloudService.name);

  constructor(
    @InjectModel(CloudInstance) private readonly instances: typeof CloudInstance,
    @InjectModel(User) private readonly users: typeof User,
    private readonly coolify: CoolifyService,
    private readonly telegram: TelegramService,
  ) {}

  private view(inst: CloudInstance | null): CloudStatusView {
    if (!inst) return { enabled: true, status: 'off', lastHeartbeatAt: null, loadsSeen: 0, screenDomain: null };
    return {
      enabled: true,
      status: inst.status,
      lastHeartbeatAt: inst.lastHeartbeatAt ? new Date(inst.lastHeartbeatAt).toISOString() : null,
      loadsSeen: inst.loadsSeen ?? 0,
      screenDomain: inst.screenDomain ?? null,
    };
  }

  // Ссылка на экран (MVP, спека §5 уровень 1): пароль в query, ротируется на каждом Enable.
  screenUrl(inst: CloudInstance): string | null {
    if (!inst.screenDomain || !inst.vncPassword) return null;
    return `https://${inst.screenDomain}/vnc.html?autoconnect=1&resize=scale&password=${encodeURIComponent(inst.vncPassword)}`;
  }

  async status(userId: string): Promise<CloudStatusView> {
    return this.view(await this.instances.findOne({ where: { userId } }));
  }

  // Идемпотентно: живой сервис не трогаем; остановленный — стартуем с новым паролем; нет — создаём.
  async enable(userId: string): Promise<CloudStatusView> {
    if (!this.coolify.configured) throw new ServiceUnavailableException('Cloud browser is not configured on the server');
    let inst = await this.instances.findOne({ where: { userId } });
    if (inst && inst.coolifyServiceUuid && inst.status !== 'stopped' && inst.status !== 'error') return this.view(inst);
    if (!inst) inst = await this.instances.create({ userId, status: 'starting', vncPassword: randomPassword() });
    try {
      if (!inst.coolifyServiceUuid) {
        const { uuid } = await this.coolify.createService({
          name: `ll-${userId.slice(0, 8)}`,
          compose: renderCompose({ userId, instanceId: inst.id, imageTag: process.env.CLOUD_IMAGE_TAG || 'latest' }),
        });
        inst.coolifyServiceUuid = uuid;
      } else {
        inst.vncPassword = randomPassword(); // Enable после Disable — старая ссылка на экран умирает
      }
      await this.coolify.setEnv(inst.coolifyServiceUuid, 'NOVNC_PASSWORD', inst.vncPassword!);
      await this.coolify.start(inst.coolifyServiceUuid);
      inst.screenDomain = (await this.coolify.getFqdn(inst.coolifyServiceUuid)) ?? inst.screenDomain ?? null;
      inst.status = 'starting';
      inst.disabledAt = null;
      inst.lastStateNotified = null;
      await inst.save();
      return this.view(inst);
    } catch (e) {
      inst.status = 'error';
      await inst.save();
      this.log.error(`enable failed for ${userId}: ${(e as Error).message}`);
      throw new BadGatewayException('Could not start the cloud browser. Please try again later.');
    }
  }

  async disable(userId: string): Promise<CloudStatusView> {
    const inst = await this.instances.findOne({ where: { userId } });
    if (!inst) return this.view(null);
    if (inst.coolifyServiceUuid && inst.status !== 'stopped') {
      try { await this.coolify.stop(inst.coolifyServiceUuid); }
      catch (e) { this.log.error(`stop failed for ${userId}: ${(e as Error).message}`); }
    }
    inst.status = 'stopped';
    inst.disabledAt = new Date();
    await inst.save();
    return this.view(inst);
  }

  // Для админки: снять cloud_enabled = остановить браузер (volume остаётся до sweep через 30 дней).
  async disableForUser(userId: string): Promise<void> { await this.disable(userId); }

  async screen(userId: string): Promise<{ url: string; password: string }> {
    const inst = await this.instances.findOne({ where: { userId } });
    if (!inst || inst.status === 'stopped') throw new ConflictException('Cloud browser is not running. Enable it first.');
    const url = this.screenUrl(inst);
    if (!url) throw new ConflictException('The screen address is not ready yet. Try again in a minute.');
    return { url, password: inst.vncPassword! };
  }

  async heartbeat(userId: string, dto: HeartbeatDto): Promise<{ ok: true }> {
    const inst = await this.instances.findOne({ where: { userId } });
    if (!inst || inst.status === 'stopped') return { ok: true }; // остановленный/чужой — игнорируем
    inst.status = dto.state;
    inst.lastHeartbeatAt = new Date();
    inst.loadsSeen = dto.loadsSeen;
    if (dto.state === 'ok') inst.lastStateNotified = null;
    await inst.save();
    return { ok: true };
  }
}
```
(Watchdog — `@Cron`, `decideWatchdog` — добавляет Task 8; здесь их импортов нет.)

- [ ] **Step 6: `cloud.guard.ts`**

```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { User } from '../users/user.model';

// Гейт Cloud: users.cloud_enabled (включает админ). Идёт ПОСЛЕ JwtAuthGuard (req.user.userId).
@Injectable()
export class CloudGuard implements CanActivate {
  constructor(@InjectModel(User) private readonly users: typeof User) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.userId;
    const user = userId ? await this.users.findByPk(userId) : null;
    if (!user || !user.cloudEnabled) throw new ForbiddenException('Cloud browser is not enabled for this account');
    return true;
  }
}
```

- [ ] **Step 7: `cloud.controller.ts`**

```ts
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CloudGuard } from './cloud.guard';
import { CloudService } from './cloud.service';
import { HeartbeatDto } from './dto/heartbeat.dto';

@Controller('cloud')
@UseGuards(JwtAuthGuard, CloudGuard)
export class CloudController {
  constructor(private readonly service: CloudService) {}

  @Get('status')
  status(@Req() req: any) { return this.service.status(req.user.userId); }

  @Post('enable')
  enable(@Req() req: any) { return this.service.enable(req.user.userId); }

  @Post('disable')
  disable(@Req() req: any) { return this.service.disable(req.user.userId); }

  @Post('screen')
  screen(@Req() req: any) { return this.service.screen(req.user.userId); }

  // Heartbeat облачного браузера — раз в 5 мин на инстанс, не троттлим.
  @Post('heartbeat')
  @SkipThrottle()
  heartbeat(@Req() req: any, @Body() dto: HeartbeatDto) { return this.service.heartbeat(req.user.userId, dto); }
}
```

- [ ] **Step 8: `cloud.module.ts`** и регистрация

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from '../users/user.model';
import { TelegramModule } from '../telegram/telegram.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CloudInstance } from './cloud-instance.model';
import { CoolifyService } from './coolify.service';
import { CloudService } from './cloud.service';
import { CloudGuard } from './cloud.guard';
import { CloudController } from './cloud.controller';

@Module({
  imports: [
    SequelizeModule.forFeature([User, CloudInstance]),
    JwtModule.register({ secret: process.env.JWT_SECRET || 'dev-secret' }),
    TelegramModule,
  ],
  controllers: [CloudController],
  providers: [CoolifyService, CloudService, JwtAuthGuard, CloudGuard],
  // SequelizeModule наружу: AuthModule (DevicesService/AdminService) читает CloudInstance.
  exports: [CloudService, SequelizeModule],
})
export class CloudModule {}
```
В `app.module.ts`: импорт `ScheduleModule` из `@nestjs/schedule` → в `imports` добавить `ScheduleModule.forRoot()` и `CloudModule`.

- [ ] **Step 9: Запустить — проходит** — `cd backend && npm run build && npx jest cloud.service`. Затем `npm test` целиком.

- [ ] **Step 10: Локальный smoke HTTP** — `docker compose -p loadlens up -d && npm run start:dev` с `COOLIFY_API_URL` пустым: `curl -s localhost:3000/api/v1/cloud/status -H "Authorization: Bearer <jwt>"` → 403 `Cloud browser is not enabled…`; после `UPDATE users SET cloud_enabled=true` → `{"enabled":true,"status":"off",…}`; `POST /cloud/enable` → 503.

- [ ] **Step 11: Коммит**

```bash
git add backend/package.json backend/package-lock.json backend/src/cloud backend/src/app.module.ts
git commit -m "feat(backend): модуль cloud — enable/disable/status/screen/heartbeat под CloudGuard"
```

---

### Task 8: Backend — watchdog (чистое решение + cron + DM)

**Files:**
- Create: `backend/src/cloud/cloud-watchdog.ts`, `cloud-watchdog.spec.ts`
- Modify: `backend/src/cloud/cloud.service.ts` (+ `runWatchdog`, `@Cron`), `cloud.service.spec.ts`

**Interfaces:**
- Produces: `decideWatchdog(rows: WatchdogRow[], now: Date) → WatchdogAction[]`; `WatchdogRow = {id, status, lastHeartbeatAt, lastStateNotified, disabledAt}`; `WatchdogAction = {type:'restart'|'notify'|'sweep', id, status?}`; константы `HEARTBEAT_TIMEOUT_MS = 15*60*1000`, `SWEEP_AFTER_MS = 30*24*60*60*1000`; `CloudService.runWatchdog(now = new Date()) → Promise<{restarted, notified, swept}>`.

- [ ] **Step 1: Тесты `cloud-watchdog.spec.ts`**

```ts
import { decideWatchdog, HEARTBEAT_TIMEOUT_MS, SWEEP_AFTER_MS } from './cloud-watchdog';

const now = new Date('2026-09-13T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const row = (o: Partial<any>) => ({ id: 'i', status: 'ok', lastHeartbeatAt: ago(60000), lastStateNotified: null, disabledAt: null, ...o });

describe('decideWatchdog', () => {
  it('ok со свежим heartbeat — ничего', () => {
    expect(decideWatchdog([row({})], now)).toEqual([]);
  });
  it('ok без heartbeat дольше 15 мин → restart + notify stale', () => {
    expect(decideWatchdog([row({ lastHeartbeatAt: ago(HEARTBEAT_TIMEOUT_MS + 1) })], now))
      .toEqual([{ type: 'restart', id: 'i' }, { type: 'notify', id: 'i', status: 'stale' }]);
  });
  it('starting без heartbeat — не рестартим (пользователь ещё не залогинился)', () => {
    expect(decideWatchdog([row({ status: 'starting', lastHeartbeatAt: null })], now)).toEqual([]);
  });
  it('logged_out/stale → notify один раз: при lastStateNotified === status молчим', () => {
    expect(decideWatchdog([row({ status: 'logged_out' })], now)).toEqual([{ type: 'notify', id: 'i', status: 'logged_out' }]);
    expect(decideWatchdog([row({ status: 'logged_out', lastStateNotified: 'logged_out' })], now)).toEqual([]);
    expect(decideWatchdog([row({ status: 'stale', lastStateNotified: 'logged_out' })], now)).toEqual([{ type: 'notify', id: 'i', status: 'stale' }]);
  });
  it('stopped старше 30 дней → sweep; моложе — ничего; error — ничего', () => {
    expect(decideWatchdog([row({ status: 'stopped', disabledAt: ago(SWEEP_AFTER_MS + 1) })], now)).toEqual([{ type: 'sweep', id: 'i' }]);
    expect(decideWatchdog([row({ status: 'stopped', disabledAt: ago(1000) })], now)).toEqual([]);
    expect(decideWatchdog([row({ status: 'error' })], now)).toEqual([]);
  });
});
```

- [ ] **Step 2: Запустить — падает** — `cd backend && npx jest cloud-watchdog`.

- [ ] **Step 3: `cloud-watchdog.ts`**

```ts
/* Решение watchdog — чистая функция без БД/Nest (как device-limit.ts): тестируется без моков. */
import { CloudStatus } from './cloud-instance.model';

export const HEARTBEAT_TIMEOUT_MS = 15 * 60 * 1000;      // ok без heartbeat дольше → restart
export const SWEEP_AFTER_MS = 30 * 24 * 60 * 60 * 1000;  // stopped дольше → удалить сервис + volume

export type WatchdogRow = {
  id: string; status: CloudStatus; lastHeartbeatAt: Date | null; lastStateNotified: string | null; disabledAt: Date | null;
};
export type WatchdogAction =
  | { type: 'restart'; id: string }
  | { type: 'notify'; id: string; status: 'stale' | 'logged_out' }
  | { type: 'sweep'; id: string };

export function decideWatchdog(rows: WatchdogRow[], now: Date): WatchdogAction[] {
  const out: WatchdogAction[] = [];
  for (const r of rows) {
    if (r.status === 'stopped') {
      if (r.disabledAt && now.getTime() - r.disabledAt.getTime() > SWEEP_AFTER_MS) out.push({ type: 'sweep', id: r.id });
      continue;
    }
    if (r.status === 'ok') {
      if (r.lastHeartbeatAt && now.getTime() - r.lastHeartbeatAt.getTime() > HEARTBEAT_TIMEOUT_MS) {
        out.push({ type: 'restart', id: r.id });
        if (r.lastStateNotified !== 'stale') out.push({ type: 'notify', id: r.id, status: 'stale' });
      }
      continue;
    }
    if ((r.status === 'logged_out' || r.status === 'stale') && r.lastStateNotified !== r.status)
      out.push({ type: 'notify', id: r.id, status: r.status });
    // starting / error — ждём пользователя или следующий Enable
  }
  return out;
}
```

- [ ] **Step 4: Тесты `runWatchdog` в `cloud.service.spec.ts`** — расширить `makeService`: добавить в `instances` `findAll: jest.fn().mockImplementation(async () => inst ? [inst] : [])` и `destroy: jest.fn()` на инстансе (`inst.destroy = jest.fn()`), затем:

```ts
describe('CloudService.runWatchdog', () => {
  const base = () => ({ id: 'inst-1', userId: 'u1', coolifyServiceUuid: 'svc-1', vncPassword: 'p', screenDomain: 'd.example', loadsSeen: 0, lastStateNotified: null, disabledAt: null });

  it('ok без heartbeat 15 мин → restart, статус stale, DM "restarted" с ссылкой, lastStateNotified=stale', async () => {
    const { svc, coolify, telegram, inst } = makeService({ inst: { ...base(), status: 'ok', lastHeartbeatAt: new Date(Date.now() - 16 * 60000) } });
    const r = await svc.runWatchdog();
    expect(coolify.restart).toHaveBeenCalledWith('svc-1');
    expect(inst.status).toBe('stale');
    expect(inst.lastStateNotified).toBe('stale');
    expect(telegram.sendMessageTo).toHaveBeenCalledWith('42', expect.stringContaining('https://d.example/vnc.html'));
    expect(r).toEqual({ restarted: 1, notified: 1, swept: 0 });
  });

  it('logged_out → DM один раз; второй прогон молчит', async () => {
    const { svc, telegram } = makeService({ inst: { ...base(), status: 'logged_out', lastHeartbeatAt: new Date() } });
    await svc.runWatchdog(); await svc.runWatchdog();
    expect(telegram.sendMessageTo).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessageTo.mock.calls[0][1]).toContain('signed out of DAT');
  });

  it('без Telegram — статус помечаем, DM не шлём и не падаем', async () => {
    const m = makeService({ inst: { ...base(), status: 'stale', lastHeartbeatAt: new Date() } });
    m.telegram.sendMessageTo.mockClear();
    (m.svc as any).users.findByPk.mockResolvedValue({ id: 'u1', telegramChatId: null });
    await expect(m.svc.runWatchdog()).resolves.toEqual({ restarted: 0, notified: 0, swept: 0 });
    expect(m.inst.lastStateNotified).toBe('stale');
  });

  it('stopped > 30 дней → delete с volume, строка удаляется', async () => {
    const { svc, coolify, inst } = makeService({ inst: { ...base(), status: 'stopped', disabledAt: new Date(Date.now() - 31 * 86400000) } });
    inst.destroy = jest.fn();
    await svc.runWatchdog();
    expect(coolify.deleteService).toHaveBeenCalledWith('svc-1', { deleteVolumes: true });
    expect(inst.destroy).toHaveBeenCalled();
  });

  it('без COOLIFY_API_URL — no-op', async () => {
    const { svc, instances } = makeService({ configured: false, inst: { ...base(), status: 'logged_out' } });
    await expect(svc.runWatchdog()).resolves.toEqual({ restarted: 0, notified: 0, swept: 0 });
    expect(instances.findAll).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Реализация в `cloud.service.ts`** — добавить импорты `Cron` (из `@nestjs/schedule`) и `decideWatchdog, WatchdogRow` (из `./cloud-watchdog`), методы:

```ts
  private notifyText(status: 'stale' | 'logged_out', inst: CloudInstance, restarted: boolean): string {
    const link = this.screenUrl(inst);
    const tail = link ? `\nOpen the screen: ${link}` : '';
    if (status === 'logged_out') return `⚠️ Your cloud browser is signed out of DAT. Sign in to keep alerts running.${tail}`;
    return restarted
      ? `🔁 Your cloud browser stopped responding and was restarted. Check that DAT search is open.${tail}`
      : `⚠️ Your cloud browser has not received loads from DAT for a while. Check the DAT tab.${tail}`;
  }

  // Каждые 5 минут (спека §5). Действия — из чистой decideWatchdog; здесь только исполнение.
  @Cron('*/5 * * * *')
  async watchdogTick(): Promise<void> {
    try { await this.runWatchdog(); }
    catch (e) { this.log.error(`watchdog failed: ${(e as Error).message}`); }
  }

  async runWatchdog(now = new Date()): Promise<{ restarted: number; notified: number; swept: number }> {
    const result = { restarted: 0, notified: 0, swept: 0 };
    if (!this.coolify.configured) return result;
    const rows = await this.instances.findAll();
    const byId = new Map(rows.map((r) => [r.id, r]));
    const actions = decideWatchdog(rows.map((r): WatchdogRow => ({
      id: r.id, status: r.status, lastHeartbeatAt: r.lastHeartbeatAt, lastStateNotified: r.lastStateNotified, disabledAt: r.disabledAt,
    })), now);
    const restartedIds = new Set<string>();
    for (const a of actions) {
      const inst = byId.get(a.id)!;
      try {
        if (a.type === 'restart') {
          if (inst.coolifyServiceUuid) await this.coolify.restart(inst.coolifyServiceUuid);
          inst.status = 'stale';
          await inst.save();
          restartedIds.add(inst.id);
          result.restarted++;
        } else if (a.type === 'notify') {
          const user = await this.users.findByPk(inst.userId);
          inst.lastStateNotified = a.status; // помечаем и без Telegram — иначе будем «пытаться» каждые 5 минут
          await inst.save();
          if (user?.telegramChatId) {
            const ok = await this.telegram.sendMessageTo(user.telegramChatId, this.notifyText(a.status, inst, restartedIds.has(inst.id)));
            if (ok) result.notified++;
          }
        } else if (a.type === 'sweep') {
          if (inst.coolifyServiceUuid) await this.coolify.deleteService(inst.coolifyServiceUuid, { deleteVolumes: true });
          await inst.destroy();
          result.swept++;
        }
      } catch (e) {
        this.log.error(`watchdog ${a.type} failed for ${inst.userId}: ${(e as Error).message}`);
      }
    }
    return result;
  }
```

- [ ] **Step 6: Запустить — проходит** — `cd backend && npm run build && npm test`.

- [ ] **Step 7: Коммит**

```bash
git add backend/src/cloud/cloud-watchdog.ts backend/src/cloud/cloud-watchdog.spec.ts backend/src/cloud/cloud.service.ts backend/src/cloud/cloud.service.spec.ts
git commit -m "feat(backend): watchdog облачных браузеров — restart/DM/sweep по cron"
```

---

### Task 9: Backend — лимит устройств пропускает `cloud:<instanceId>` своего инстанса

**Files:**
- Modify: `backend/src/auth/devices.service.ts`, `devices.service.spec.ts`, `backend/src/auth/auth.module.ts`

**Interfaces:**
- Consumes: `CloudInstance` (Task 5), `CloudModule` exports (Task 7).
- Produces: `DevicesService.isCloudClient(userId, clientId) → Promise<boolean>`; в `registerOnAuth`/`verifyOnRefresh` такой clientId не регистрируется и никого не вытесняет.

- [ ] **Step 1: Тесты** — в `devices.service.spec.ts` фабрику `makeService` расширить третьим аргументом: `new DevicesService(model, users, cloud)` где `cloud = { findOne: jest.fn().mockResolvedValue(null) }`, вернуть `cloud` из фабрики. Добавить:

```ts
describe('DevicesService: облачный инстанс', () => {
  const UUID = '123e4567-e89b-12d3-a456-426614174000';
  it('cloud:<id> своего инстанса — не регистрируется и не вытесняет', async () => {
    const { svc, model, cloud } = makeService([row('a', 1), row('b', 1), row('c', 1)]);
    cloud.findOne.mockResolvedValue({ id: UUID, userId: 'u1' });
    await svc.registerOnAuth(proUser(), `cloud:${UUID}`);
    await svc.verifyOnRefresh(proUser(), `cloud:${UUID}`);
    expect(cloud.findOne).toHaveBeenCalledWith({ where: { id: UUID, userId: 'u1' } });
    expect(model.upsert).not.toHaveBeenCalled();
    expect(model.destroy).not.toHaveBeenCalled();
  });
  it('cloud:<чужой или несуществующий id> — обычное устройство (лимит работает)', async () => {
    const { svc, model, users } = makeService([row('a', 1), row('b', 1), row('c', 1)]);
    await svc.registerOnAuth(proUser(), `cloud:${UUID}`);
    expect(model.upsert).toHaveBeenCalled();
    expect(users.increment).toHaveBeenCalled(); // 4-е устройство → вытеснение
  });
  it('cloud:<не-uuid> — в БД не ходим, обычное устройство', async () => {
    const { svc, cloud, model } = makeService([]);
    await svc.registerOnAuth(freeUser(), 'cloud:whatever');
    expect(cloud.findOne).not.toHaveBeenCalled();
    expect(model.upsert).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Запустить — падает** — `cd backend && npx jest devices.service`.

- [ ] **Step 3: Реализация** — в `devices.service.ts`:

```ts
import { CloudInstance } from '../cloud/cloud-instance.model';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
```
конструктор: `@InjectModel(CloudInstance) private readonly cloud: typeof CloudInstance,` третьим параметром. Метод:

```ts
  // Облачный браузер представляется cloud:<instanceId>. Слот лимита не занимает — но только если
  // инстанс существует и принадлежит этому пользователю: иначе любой мог бы обойти лимит префиксом.
  async isCloudClient(userId: string, clientId: string | null): Promise<boolean> {
    if (!clientId || !clientId.startsWith('cloud:')) return false;
    const id = clientId.slice('cloud:'.length);
    if (!UUID_RE.test(id)) return false;
    return !!(await this.cloud.findOne({ where: { id, userId } }));
  }
```
В `registerOnAuth` и `verifyOnRefresh` сразу после `if (user.role === 'admin') return;` добавить `if (await this.isCloudClient(user.id, clientId)) return;`.

`auth.module.ts`: импорт `CloudModule` из `../cloud/cloud.module` → в `imports` (даёт `CloudInstance`-репозиторий и `CloudService` для Task 10).

- [ ] **Step 4: Запустить — проходит** — `cd backend && npm run build && npm test`.

- [ ] **Step 5: Коммит**

```bash
git add backend/src/auth/devices.service.ts backend/src/auth/devices.service.spec.ts backend/src/auth/auth.module.ts
git commit -m "feat(backend): лимит устройств не считает cloud:<instanceId> своего облачного браузера"
```

---

### Task 10: Backend — админка: тумблер `cloud_enabled`, колонка Cloud

**Files:**
- Modify: `backend/src/auth/dto/admin.dto.ts`, `admin.service.ts`, `admin.service.spec.ts`, `admin.controller.ts`, `backend/public/admin.html`

**Interfaces:**
- Consumes: `CloudService.disableForUser` (Task 7), `CloudInstance`.
- Produces: `PATCH /admin/users/:email/cloud {enabled}` → `{email, cloudEnabled}`; `AdminUserView` + `cloudEnabled: boolean`, `cloudStatus: string|null`, `cloudHeartbeatAt: Date|null`.

- [ ] **Step 1: Тесты в `admin.service.spec.ts`** — в `beforeEach` этого файла объявить `cloudInstances: any = { findAll: jest.fn(() => Promise.resolve([])) }` и `cloud: any = { disableForUser: jest.fn(() => Promise.resolve()) }` (переменные уровня `describe`, как `devicesModel`), а конструктор `new AdminService(userModel, devicesModel, lanes, cloudInstances, cloud)`. Пользователям карты `users` добавить `cloudEnabled: false`. Тесты:

```ts
  it('setCloudEnabled(false) выключает флаг и останавливает браузер; true — только флаг', async () => {
    users['pro@b.md'].cloudEnabled = true;
    await expect(service.setCloudEnabled('pro@b.md', false)).resolves.toEqual({ email: 'pro@b.md', cloudEnabled: false });
    expect(cloud.disableForUser).toHaveBeenCalledWith('u2');
    await service.setCloudEnabled('pro@b.md', true);
    expect(cloud.disableForUser).toHaveBeenCalledTimes(1);
    expect(users['pro@b.md'].cloudEnabled).toBe(true);
  });
  it('listUsers: подмешивает cloudStatus/cloudHeartbeatAt из cloud_instances', async () => {
    const hb = new Date();
    users['pro@b.md'].cloudEnabled = true;
    cloudInstances.findAll.mockResolvedValue([{ userId: 'u2', status: 'ok', lastHeartbeatAt: hb }]);
    const v = (await service.listUsers()).find((u) => u.email === 'pro@b.md')!;
    expect(v).toEqual(expect.objectContaining({ cloudEnabled: true, cloudStatus: 'ok', cloudHeartbeatAt: hb }));
    const free = (await service.listUsers()).find((u) => u.email === 'a@b.md')!;
    expect(free).toEqual(expect.objectContaining({ cloudEnabled: false, cloudStatus: null, cloudHeartbeatAt: null }));
  });
```

- [ ] **Step 2: Запустить — падает** — `cd backend && npx jest admin.service`.

- [ ] **Step 3: Реализация**

`dto/admin.dto.ts`:
```ts
export class SetCloudDto {
  @IsBoolean()
  enabled: boolean;
}
```

`admin.service.ts`: импорт `CloudInstance` и `CloudService`; в `AdminUserView` добавить `cloudEnabled: boolean; cloudStatus: string | null; cloudHeartbeatAt: Date | null;`; конструктор дополнить `@InjectModel(CloudInstance) private readonly cloudInstances: typeof CloudInstance, private readonly cloud: CloudService`; `view(u, devices = 0, ci?: CloudInstance | null)` добавляет `cloudEnabled: !!u.cloudEnabled, cloudStatus: ci?.status ?? null, cloudHeartbeatAt: ci?.lastHeartbeatAt ?? null`; в `listUsers` после `counts`:
```ts
    const cis = await this.cloudInstances.findAll({ where: { userId: rows.map((u) => u.id) } });
    const ciByUser = new Map(cis.map((c) => [c.userId, c]));
    return rows.map((u) => this.view(u, byUser.get(u.id) ?? 0, ciByUser.get(u.id) ?? null));
```
и метод:
```ts
  async setCloudEnabled(emailRaw: string, enabled: boolean) {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.userModel.findOne({ where: { email } });
    if (!user) throw new NotFoundException('user not found');
    user.cloudEnabled = enabled;
    await user.save();
    if (!enabled) await this.cloud.disableForUser(user.id); // снятый флаг = браузер выключен
    return { email: user.email, cloudEnabled: user.cloudEnabled };
  }
```
`admin.controller.ts`:
```ts
  @Patch('users/:email/cloud')
  setCloud(@Param('email') email: string, @Body() dto: SetCloudDto) {
    return this.service.setCloudEnabled(email, dto.enabled);
  }
```

`admin.html`: в `<tr>` заголовка после `<th>Алерты</th>` добавить `<th>Cloud</th>`; в строке после ячейки `alertsEnabled` добавить
```js
          <td>${u.cloudEnabled ? (u.cloudStatus ? esc(u.cloudStatus) + (u.cloudHeartbeatAt ? ' · ' + new Date(u.cloudHeartbeatAt).toLocaleTimeString('ru-RU') : '') : 'вкл') : '—'}</td>
```
и в действиях после `planBtn`:
```js
        const cloudBtn = document.createElement('button');
        cloudBtn.textContent = u.cloudEnabled ? 'cloud off' : 'cloud on';
        cloudBtn.onclick = () => act(() => api('/admin/users/' + encodeURIComponent(u.email) + '/cloud',
          { method: 'PATCH', body: JSON.stringify({ enabled: !u.cloudEnabled }) }));
        actions.appendChild(cloudBtn);
```

- [ ] **Step 4: Запустить — проходит** — `cd backend && npm run build && npm test`. Открыть `http://localhost:3000/admin.html` локально: колонка Cloud и кнопка работают.

- [ ] **Step 5: Коммит**

```bash
git add backend/src/auth/dto/admin.dto.ts backend/src/auth/admin.service.ts backend/src/auth/admin.service.spec.ts backend/src/auth/admin.controller.ts backend/public/admin.html
git commit -m "feat(admin): тумблер cloud_enabled и колонка Cloud"
```

---

### Task 11: Popup — секция «Cloud browser»

**Files:**
- Modify: `extension/popup.html` (`<div class="bd" id="cloud"></div>` после `#telegram`), `extension/popup.js`

**Interfaces:**
- Consumes: `LLAPI.getMe().cloudEnabled`, `LLAPI.cloudStatus/cloudEnable/cloudDisable/cloudScreen` (Task 3).
- Produces: `renderCloud(me)`; согласие хранится в `chrome.storage.local.ll_cloud_consent = true`.

- [ ] **Step 1: popup.html** — после `<div class="bd" id="telegram"></div>` добавить `<div class="bd" id="cloud"></div>`. Стиль: `.mono { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }`.

- [ ] **Step 2: popup.js — `renderCloud`** (после `renderTelegram`):

```js
// ---- Cloud browser (Pro Cloud): включает админ (cloud_enabled), пользователь — Enable/Open screen/Disable ----
const cloudEl = document.getElementById("cloud");
const CLOUD_LABELS = {
  off: "not started",
  starting: "starting — open the screen, sign in to DAT and LoadLens",
  ok: "running ✓",
  logged_out: "signed out of DAT — open the screen and sign in",
  stale: "no loads from DAT — open the screen and check the search",
  stopped: "stopped",
  error: "error — try Enable again or contact support",
};
function agoMin(iso) { return iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) + " min ago" : "—"; }

async function renderCloud(me) {
  if (me === undefined) me = await LLAPI.getMe().catch(() => null);
  if (!me || !me.cloudEnabled) { cloudEl.innerHTML = ""; return; }
  const st = await LLAPI.cloudStatus();
  if (!st) { cloudEl.innerHTML = '<h4>Cloud browser</h4><div class="note">Could not load status.</div>'; return; }
  const running = st.status !== "off" && st.status !== "stopped";
  const { ll_cloud_consent } = await chrome.storage.local.get("ll_cloud_consent");
  cloudEl.innerHTML = '<h4>Cloud browser <span class="plan pro">PRO CLOUD</span></h4>' +
    `<div class="row"><span class="k">Status</span><span>${CLOUD_LABELS[st.status] || st.status}</span></div>` +
    (running ? `<div class="row"><span class="k">Last heartbeat</span><span>${agoMin(st.lastHeartbeatAt)}</span></div>` : "") +
    (running
      ? '<button id="cl-open">Open screen</button>' +
        '<div class="note">Password (if the screen asks): <span id="cl-pass" class="mono">…</span> <button id="cl-copy" class="linkbtn">copy</button></div>' +
        '<div class="note">Signing in to DAT on this computer will sign out your cloud browser.</div>' +
        '<button id="cl-off" class="danger">Disable Cloud</button>'
      : (ll_cloud_consent ? "" :
          '<label class="note"><input id="cl-consent" type="checkbox" style="width:auto"> I am responsible for my DAT account; DAT may restrict accounts used from cloud servers.</label>') +
        `<button id="cl-on"${ll_cloud_consent ? "" : " disabled"}>Enable Cloud</button>` +
        '<div class="note">Your own Chromium with DAT One and LoadLens runs 24/7 on our server: auto-pilot and Telegram alerts keep working without a computer at home. One DAT sign-in at a time.</div>');
  const consent = document.getElementById("cl-consent");
  if (consent) consent.onchange = () => { document.getElementById("cl-on").disabled = !consent.checked; };
  const on = document.getElementById("cl-on");
  if (on) on.onclick = async () => {
    on.disabled = true; on.textContent = "Starting…";
    try { await chrome.storage.local.set({ ll_cloud_consent: true }); await LLAPI.cloudEnable(); renderCloud(me); }
    catch (e) { alert(e.message); renderCloud(me); }
  };
  const open = document.getElementById("cl-open");
  if (open) {
    LLAPI.cloudScreen().then((s) => { document.getElementById("cl-pass").textContent = s.password; }).catch(() => {});
    open.onclick = async () => {
      try { const s = await LLAPI.cloudScreen(); chrome.tabs.create({ url: s.url }); }
      catch (e) { alert(e.message); }
    };
    document.getElementById("cl-copy").onclick = async () => {
      try { const s = await LLAPI.cloudScreen(); await navigator.clipboard.writeText(s.password); } catch (e) { alert(e.message); }
    };
  }
  const off = document.getElementById("cl-off");
  if (off) off.onclick = async () => {
    if (!confirm("Disable the cloud browser? Alerts from it will stop. Your DAT session stays saved for 30 days.")) return;
    try { await LLAPI.cloudDisable(); renderCloud(me); } catch (e) { alert(e.message); }
  };
}
```
Во всех местах, где вызываются `renderFleet(x); renderTelegram(x);` (logout, delete, login/register, reset, стартовый `getMe().then`), добавить `renderCloud(x);` с тем же аргументом.

- [ ] **Step 3: Проверка** — `npm test` (check:lang на кириллицу в popup.js). В Chrome: пользователь без `cloud_enabled` → секции нет; с флагом (поставить через админку локально) → секция, чекбокс согласия включает кнопку; Enable против локального бэкенда без `COOLIFY_API_URL` → alert «Cloud browser is not configured on the server», статус остаётся `not started`.

- [ ] **Step 4: Коммит**

```bash
git add extension/popup.html extension/popup.js
git commit -m "feat(popup): секция Cloud browser — Enable/Open screen/Disable, согласие"
```

---

### Task 12: Документация и релизные заметки

**Files:**
- Modify: `backend/.env.example`, `CLAUDE.md`, `CHANGELOG.md`, `tasks/0018-loadlens-cloud-browser.md`

- [ ] **Step 1: `.env.example`** — добавить блок:

```
# LoadLens Cloud (браузер в облаке). Без COOLIFY_API_URL фича выключена (/cloud/* → 503, watchdog молчит).
# URL — внутренний адрес Coolify из docker-сети (бэкенд и Coolify на одном сервере), токен — write+deploy.
COOLIFY_API_URL=
COOLIFY_API_TOKEN=
COOLIFY_CLOUD_SERVER_UUID=f8xhhqagybtdjk14krvrp0kq
COOLIFY_CLOUD_PROJECT_UUID=ocls09doyppd1f5ze0fsjj8r
COOLIFY_CLOUD_ENV_NAME=production
CLOUD_IMAGE_TAG=latest
```
Также **удалить последнюю строку `LoadLens-Admin-2026!`** из `.env.example` (похоже на случайно закоммиченный пароль; если он где-то используется — сменить).

- [ ] **Step 2: CLAUDE.md** — в «Структура» добавить строки `cloud-browser/` (прод-образ, GHCR, spike/ — throwaway), `extension/cloud.js (LLCLOUD)` + `cloud.config.js`, `backend/src/cloud/` (одна строка: Coolify-оркестрация, cloud_instances, watchdog). В «Конвенции» — пункт **Cloud browser** (8–10 строк): DE-сервер, Coolify — единственный оркестратор, cloud mode через `cloud.config.js`, `X-Client-Id: cloud:<id>` только для своего инстанса, статусы/watchdog-тайминги, ToS-граница (§6 спеки), env-переменные, фича-флаг `COOLIFY_API_URL`. В «Деплой» таблицу дополнить строкой `cloud image | ghcr.io/bogbuk/loadlens-cloud-browser (workflow cloud-browser.yml)` и `DNS *.cloud.loadlens.krait.studio — DNS-only, TLS от Traefik`.

- [ ] **Step 3: CHANGELOG.md** — секция `## [Unreleased]` (или следующая версия 0.7.0): «Cloud browser (Pro Cloud): …» три строки для пользователя.

- [ ] **Step 4: Прогон всех тестов** — `npm test` (корень) и `cd backend && npm run build && npm test` → зелено. Отметить Task 1–12 в `tasks/0018`.

- [ ] **Step 5: Коммит**

```bash
git add backend/.env.example CLAUDE.md CHANGELOG.md tasks/0018-loadlens-cloud-browser.md
git commit -m "docs(cloud): env, CLAUDE.md, changelog для LoadLens Cloud"
```

---

### Task 13: Раскатка на DE-сервере и первый тенант (наш аккаунт)

**Files:** нет кода; результаты — в `tasks/0018` и `docs/research/2026-09-13-coolify-services-api.md`.

Предусловия от владельца: токен Coolify `loadlens-backend` (write+deploy), доступ к Cloudflare DNS `krait.studio`, GitHub PAT `read:packages` для сервера (если пакет GHCR приватный).

- [ ] **Step 1: DNS** — Cloudflare: запись `A *.cloud.loadlens.krait.studio → 46.4.25.36`, **DNS-only (серое облако)**. Проверка: `dig +short test.cloud.loadlens.krait.studio` → `46.4.25.36`.

- [ ] **Step 2: Coolify: wildcard domain у сервера** — UI → Servers → localhost → Wildcard Domain = `https://cloud.loadlens.krait.studio`.

- [ ] **Step 3: GHCR** — дождаться зелёного workflow `cloud-browser image` после пуша Task 1 (`gh run list --workflow cloud-browser.yml`). На сервере: `docker login ghcr.io -u bogbuk -p <PAT read:packages>` (root). Проверка: `docker pull ghcr.io/bogbuk/loadlens-cloud-browser:latest`.

- [ ] **Step 4: Адрес Coolify API из контейнера бэкенда** — на сервере:

```bash
BE=$(docker ps --filter name=hiooby9kgzj8i79ycl33drec --format '{{.Names}}' | head -1)
docker exec $BE wget -qO- --header "Authorization: Bearer <token>" http://coolify:8080/api/v1/version || \
docker exec $BE wget -qO- --header "Authorization: Bearer <token>" http://host.docker.internal:8000/api/v1/version
```
Работающий адрес → `COOLIFY_API_URL` (без `/api/v1`). Если ни один не отвечает — подключить бэкенд к сети `coolify` (Coolify UI → приложение → Connect to Predefined Network) или использовать IP хоста в docker-сети (`ip -4 addr show docker0`).

- [ ] **Step 5: Env бэкенда** — в локальный `backend/.env` добавить значения из Task 12 Step 1 с реальным токеном, затем по скиллу `coolify-deploy`: `coolify --context yoolip999 app env sync hiooby9kgzj8i79ycl33drec --file backend/.env --is-literal`; **токен в git не попадает** (`.env` в `.gitignore` — проверить).

- [ ] **Step 6: Деплой** — `git push origin main` (автодеплой), `coolify --context yoolip999 app deployments list hiooby9kgzj8i79ycl33drec` → finished; `curl -s https://loadlens.krait.studio/healthz`. Логи: `app logs …` без ошибок Sequelize (таблица `cloud_instances` создана, `cloud_enabled` добавлен).

- [ ] **Step 7: Первый тенант — наш аккаунт** — `/admin.html` → `cloud on` у своего email; в расширении (Pro) попап → Cloud browser → согласие → Enable Cloud. Ожидание: статус `starting`, через ~1 мин Open screen открывает noVNC. На сервере `docker ps` показывает контейнер сервиса; `docker inspect <ctr> --format 'mem={{.HostConfig.Memory}} shm={{.HostConfig.ShmSize}} pids={{.HostConfig.PidsLimit}} host={{.Config.Hostname}}'` → `2147483648 / 536870912 / 512 / ll-<8 симв.>` (риск №6 спеки — зафиксировать результат в `tasks/0018`). `docker exec <ctr> cat /ext/cloud.config.js` → instanceId = id строки `cloud_instances`.

- [ ] **Step 8: Логин и heartbeat** — на экране: залогиниться в DAT (**это вытеснит сессию спайка `loadlens-cloud-spike-de` — сначала снять финальный Q3: `docker stats`, `docker logs`, состояние экрана; затем `docker rm -f loadlens-cloud-spike-de`** и удалить `/root/loadlens-spike`), открыть `/search-loads`, залогиниться в LoadLens через попап расширения внутри облачного Chromium (Pro-аккаунт). Через ≤6 мин: попап на локальной машине показывает `running ✓`, `Last heartbeat: N min ago`; админка — `ok · время`. Проверить `X-Client-Id`: в админке `Устройств` у аккаунта не выросло.

- [ ] **Step 9: Watchdog** — на сервере остановить только Chromium в тенанте: `docker exec <ctr> supervisorctl -c /etc/supervisor/supervisord.conf stop chromium`; через 15–20 мин: DM «restarted» в Telegram, контейнер перезапущен Coolify (`docker ps` — новый uptime), статус снова `ok` после следующего heartbeat. Затем Disable в попапе → сервис остановлен, `status: stopped`; Enable → новый пароль, старая ссылка не подходит.

- [ ] **Step 10: Неделя наблюдения** — раз в день: `docker stats` тенанта (RAM с recycle не должна превышать ~1.5 GB), алерты приходят, письма DAT о входе нет. По итогам — `Status: done` в `tasks/0018`, запись в память проекта, затем лид из Fontana как первый клиент «Pro Cloud» (демо по Skype на облачном экране).

---

## Self-Review

- **Spec coverage.** §2 образ/оркестратор/cloud mode/экран — Tasks 1, 6, 7, 2–4, 11. §3 сервер — DE (отклонение 1), лимиты в compose — Task 6. §4 cloud mode, heartbeat, попап, лимит устройств — Tasks 2, 3, 4, 9, 11. §5 данные, эндпоинты, клиент Coolify, экран (уровень 1), watchdog, env, админка, тесты — Tasks 5–10, 12. §6 ToS-чекбокс — Task 11. §7 риски: №4 (recycle, Task 1), №6 (`docker inspect`, Task 13). §8 раскатка — Task 13. **Не реализуется (осознанно, как в спеке):** forwardAuth (уровень 2 экрана), seccomp вместо `--no-sandbox`, лендинг, Floating IP.
- **Placeholder scan.** Все шаги содержат код/команды; единственная переменная часть — Task 6 Step 1 (факты живого API), с явным правилом «код приводить к фактам».
- **Type consistency.** `CloudStatus` (Task 5) используется в `cloud-watchdog.ts`, `CloudStatusView`; `renderCompose({userId, instanceId, imageTag})` — Task 6 и 7; `CoolifyService.getFqdn/setEnv/start/stop/restart/deleteService/createService` — Task 6, 7, 8; `LLCLOUD.config/clientIdFor/heartbeat/due/markFindLoads/lastFindLoads/markHeartbeat` — Task 2, 3, 4; `LLAPI.cloudStatus/cloudEnable/cloudDisable/cloudScreen/cloudHeartbeat` — Task 3, 4, 11; `DevicesService` конструктор с 3 аргументами — Task 9 (spec-фабрика обновлена); `AdminService` конструктор с 5 аргументами — Task 10.
