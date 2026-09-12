# Ресерч: браузер в облаке (LoadLens Cloud) на Hetzner через Coolify

Дата: 2026-09-12. Контекст: спека `docs/superpowers/specs/2026-09-12-loadlens-cloud-browser-design.md`
и спайк `cloud-browser/spike/` (tasks/0013). Наш Coolify: `http://46.4.25.36:8000`, **v4.3.18**,
Docker 29.4.2, один сервер `localhost` (Hetzner, Германия).

## TL;DR

1. **Coolify умеет всё, что нужно спеке, — фраза «Coolify не умеет контейнер на тенанта по API» неверна.**
   `POST /api/v1/services` принимает произвольный compose (`docker_compose_raw`, base64) и создаёт
   сервис на любом подключённом сервере; есть `start/stop/restart/delete`, env-API, домен на сервис с
   TLS от Traefik (WebSocket noVNC проксируется из коробки). Свой слой `dockerode + mTLS + Caddy` из спеки
   можно заменить на 5 вызовов Coolify API. Coolify также сам провижинит Hetzner Cloud VM
   (`coolify server hetzner create --location ash …`).
2. **Цены Hetzner в США выросли ×3 с 15.06.2026.** CPX41 (8 vCPU/16 GB) теперь **$141.49/мес**, а не ~€30,
   как в спеке. Dedicated-серверов (AX) в Ашберне/Хиллсборо нет — только Cloud. Оптимум по цене за RAM —
   **CCX23 ($102.99, 4 dedicated vCPU/16 GB, ~7 тенантов)** → **CCX33 ($165.99, 8 vCPU/32 GB, ~14 тенантов)**.
   Себестоимость ≈ **$12–15/тенант/мес** вместо €2–4. При $59/мес юнит-экономика жива, но с меньшим запасом.
3. **Образ оставляем свой (Xvfb + x11vnc + noVNC, как в спайке).** neko — WebRTC, Traefik/Cloudflare его не
   проксируют, нужны открытые UDP-порты на тенанта; linuxserver/chromium (Selkies) — проксируется, но
   тащит терминал с passwordless sudo и только basic-auth. Наш образ — чистый WebSocket, уже проверен.
4. **Открытым остаётся Q2 спайка** (логин в DAT с датацентрового IP). Первый шаг после поднятия US-сервера —
   ручной логин через экран. Без «да» по Q2 ничего дальше не строим.

## 1. Что умеет Coolify 4.3.x (проверено по докам, API и нашему CLI 1.8.0)

### Второй сервер в США
- Coolify — multi-server: любой Linux с SSH и Docker становится worker-нодой; Coolify сам ставит Docker
  и свой Traefik на новую ноду. У каждого сервера свой прокси и свой wildcard-домен.
- **Провижининг Hetzner из Coolify:** `coolify cloud-token create` (тип `hetzner`, API-токен Hetzner
  Cloud) → `coolify server hetzner locations|server-types|images` →
  `coolify server hetzner create --cloud-token <uuid> --location ash --server-type ccx23 --image <ubuntu-24.04>
  --private-key <coolify-key-uuid> --cloud-init <file> --validate`. Это `POST /api/v1/servers/hetzner`:
  создаёт VM, заливает ключ, валидирует, ставит Docker. Или руками: `coolify server add us-ash <ip> <key-uuid> --validate`.
- `cloud-init` — место для одноразовой настройки хоста: seccomp-профиль Chromium в `/etc/docker/seccomp/chrome.json`,
  `docker login ghcr.io`, ufw (открыт только 22/80/443), unattended-upgrades.
- DNS: `*.cloud.loadlens.krait.studio` → IP US-сервера (Cloudflare proxied допустим — WebSocket через
  Cloudflare работает). В Coolify у сервера выставить wildcard domain, тогда сервисы получают домены автоматически.

### Контейнер на тенанта через API
`POST /api/v1/services` (токен с правами **write + deploy**; у токена `yoolip999` `deploy` нет — нужен новый):

| поле | значение |
|---|---|
| `server_uuid` | uuid US-сервера |
| `project_uuid` / `environment_name` | `LoadLens` / `production` (или отдельный проект `LoadLens Cloud`) |
| `name` | `ll-<userId>` |
| `docker_compose_raw` | **base64** compose (шаблон ниже) |
| `instant_deploy` | `true` |
| `urls` | `["https://ll-<userId>.cloud.loadlens.krait.studio"]` (или полагаемся на wildcard) |

Ответ `{uuid, domains}`. Дальше: `POST /services/{uuid}/stop|start|restart`, `DELETE /services/{uuid}?delete_volumes=true`
(удаление профиля через 30 дней), `GET/PATCH /services/{uuid}/envs` (ротация пароля VNC, смена `START_URL`).
Магические переменные Coolify: `SERVICE_PASSWORD_VNC` (генерится и хранится Coolify), `SERVICE_FQDN_BROWSER_6080`.

Ограничения, которые важно знать:
- **Services = только готовые образы, `build:` нет.** Образ собираем в GHCR через GitHub Actions
  (спека это и планировала). На US-сервере — `docker login ghcr.io` read-токеном (cloud-init).
- **Лимиты ресурсов из UI на compose-сервисы не применяются** (issue #10676, v4.1.2, июнь 2026, открыт).
  Но ключи прямо в compose работают: `mem_limit`, `cpus`, `pids_limit`, `shm_size`, `deploy.resources.limits`.
- **Traefik-labels basic-auth на «вставленном» compose иногда теряются** (issue #6939). Для нас некритично —
  auth экрана делаем не basic-auth (см. §4), но любой свой label проверять через `docker inspect` после деплоя.
- `security_opt`/`cap_add`/`hostname` парсер Coolify не вырезает (проходят как есть) — но это надо
  **подтвердить на живом сервере** первым же деплоем (`docker inspect ll-<id> | jq .[0].HostConfig`).
- Coolify API у нас на **plain HTTP** (`http://46.4.25.36:8000`). Бэкенд LoadLens живёт на том же хосте —
  ходить в API через `http://host.docker.internal:8000` (или `coolify:8080` в docker-сети `coolify`), токен
  по публичному HTTP не гонять. Либо повесить HTTPS на дашборд Coolify.
- Готового one-click шаблона браузера в Coolify нет (в списке 88 типов — только `filebrowser`), значит
  custom compose в любом случае.

## 2. Сервер в США: Hetzner после 15.06.2026

Ашберн (`ash`, us-east) и Хиллсборо (`hil`, us-west): **только Cloud** (CPX shared / CCX dedicated vCPU),
CX/CAX и dedicated Robot-серверов нет. Трафик в США — 1–8 TB включено, overage $1/TB (нам хватит: noVNC
грузит сеть только пока экран открыт, DAT-выдача — мегабайты в день).

| тип | vCPU | RAM | $/мес (США, excl. IPv4 $0.60) | тенантов при 2 GB лимите | $/тенант |
|---|---|---|---|---|---|
| CPX31 | 4 shared | 8 GB | 73.49 | ~3 | ~24 |
| CPX41 | 8 shared | 16 GB | 141.49 | ~7 | ~20 |
| CPX51 | 12 shared | 32 GB | 279.49 | ~14 | ~20 |
| **CCX23** | 4 dedicated | 16 GB | **102.99** | ~7 | **~15** |
| **CCX33** | 8 dedicated | 32 GB | **165.99** | ~14 | **~12** |
| CCX43 | 16 dedicated | 64 GB | 329.49 | ~28 | ~12 |

Замер спайка: тенант ≈ 1.2 GB RAM, ~0.35 ядра (Xvfb-рендер). На CCX23 семь тенантов = 2.5 ядра — ок.
**Рекомендация:** старт на **CCX23** (наш аккаунт + лид из Fontana + запас), при >6 тенантах — CCX33.
Дополнительные IP: Cloud Floating IPv4 — $3.50/мес; egress контейнера через конкретный floating IP требует
SNAT-правил на хосте (реально, но не в MVP; «≤10 аккаунтов на IP» на CCX23 и так не превышается).

Альтернативы (не проверяли, на случай если Hetzner US дорого): Vultr / DigitalOcean (8 vCPU/16 GB ≈ $96),
OVH US (Vint Hill, VA). Существующий немецкий сервер `46.4.25.36` годится **только для внутреннего
спайка** (немецкий IP для DAT — лишний гео-риск; и Q2 он не отвечает).

## 3. Образ: свой vs готовые

| | (A) свой: Xvfb+x11vnc+noVNC (спайк) | (B) m1k1o/neko `chromium` | (C) linuxserver/chromium (Selkies) |
|---|---|---|---|
| транспорт экрана | WebSocket (VNC) | **WebRTC** (+WS сигналинг) | WebSocket (pixelflux) / WebRTC |
| через Traefik/Cloudflare | да, из коробки | **нет** — нужны `NEKO_WEBRTC_EPR`/`UDPMUX`/`TCPMUX` порты наружу на тенанта или TURN | да (порт 3000 «must be proxied») |
| auth | пароль VNC (`-rfbauth`) | свой multiuser (`NEKO_MEMBER_MULTIUSER_*_PASSWORD`) | только basic-auth `CUSTOM_USER`/`PASSWORD` |
| расширение | `--load-extension=/ext` (наше) | policies.json `ExtensionInstallForcelist` (Web Store) или патч supervisord | `CHROME_CLI="--load-extension=/config/ext …"` |
| профиль | volume `/data/profile` + rm SingletonLock | volume `/home/neko/.config/chromium` (uid 1000, фикс hostname) | volume `/config` |
| sandbox | `--no-sandbox` (uid 1000) | тоже `--no-sandbox` | н/д |
| лишнее | нет | комнаты, мультиюзер, WebRTC-стек | терминал + **passwordless sudo**, файловый менеджер (гасить `HARDEN_DESKTOP`, `DISABLE_SUDO`, `DISABLE_TERMINALS`) |
| RAM (замер/оценка) | 1.2 GB | ~1.5 GB (энкодер) | ~1.5 GB |

Вывод: **(A)**. Это единственный вариант, где экран — чистый WebSocket за Traefik без дырок в фаерволе, а
Chromium запускается ровно с нашими флагами. (C) — запасной, если noVNC-UX будет мешать (Selkies
плавнее), но ценой hardening'а. (B) под Coolify не подходит: WebRTC мимо прокси.

Что добавить к спайк-образу для прода:
- `hostname: ll-<userId>` в compose (стабильный hostname → нет диалога «profile in use»; `rm SingletonLock`
  в стартовом скрипте оставить как страховку);
- на x86 — `google-chrome-stable` вместо Debian-Chromium (ближе к тому, что видит DAT у обычных пользователей);
- sandbox: MVP — `--no-sandbox` под uid 1000 (так же делает neko); следующий шаг —
  `security_opt: ["seccomp:/etc/docker/seccomp/chrome.json"]` (профиль Jess Frazelle с разрешёнными
  `clone(CLONE_NEWUSER)`/`unshare`/`setns`) и убрать флаг. Файл кладётся на хост cloud-init'ом, т.к.
  seccomp читается демоном с хоста, а не из контейнера;
- managed-policy `ll_cloud_mode: true` (`/etc/opt/chrome/policies/managed/loadlens.json`), как в спеке §4;
- `restart: unless-stopped`, `mem_limit: 2g`, `cpus: 1`, `pids_limit: 512`, `shm_size: 512m`.

### Шаблон compose на тенанта (то, что уходит в `docker_compose_raw`)

```yaml
services:
  browser:
    image: ghcr.io/bogbuk/loadlens-cloud-browser:${IMAGE_TAG:-latest}
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
    # security_opt: ["seccomp:/etc/docker/seccomp/chrome.json"]   # после отказа от --no-sandbox
volumes:
  profile:
```

Портов наружу нет; Traefik ходит в контейнер по docker-сети сервиса.

## 4. Как меняется архитектура спеки

```
popup «Cloud» ─JWT─▶ backend /cloud/* ─Coolify API (host.docker.internal:8000)─▶ Coolify ─SSH─▶ US-сервер (ash)
                                                                                  ├─ Traefik: ll-<uid>.cloud.loadlens.krait.studio ─▶ ll-<uid>:6080 (noVNC, WSS)
                                                                                  └─ service ll-<uid> (compose выше) + volume
```

| в спеке | на Coolify |
|---|---|
| `docker.service.ts` (dockerode, mTLS, порт 2376) | `coolify.service.ts`: `POST /services`, `…/start`, `…/stop`, `…/restart`, `DELETE …`, `PATCH …/envs` |
| Caddy `/screen/<token>` + `GET /cloud/screen/resolve` | Traefik Coolify + домен на тенанта; auth экрана — см. ниже |
| env `CLOUD_DOCKER_HOST/CA/CERT/KEY` | `COOLIFY_API_URL`, `COOLIFY_API_TOKEN`, `COOLIFY_CLOUD_SERVER_UUID`, `COOLIFY_CLOUD_PROJECT_UUID`, `CLOUD_IMAGE` |
| `cloud_instances.container_id` | `cloud_instances.coolify_service_uuid` |
| watchdog → `docker restart` | watchdog → `POST /services/{uuid}/restart` |

**Auth экрана — два уровня, MVP и потом:**
1. MVP: ссылка `https://ll-<uid>.cloud…/vnc.html?autoconnect=1&resize=scale&password=<SERVICE_PASSWORD_VNC>`
   (пароль хранит Coolify, бэкенд читает через `GET /services/{uuid}/envs`). Ротация пароля = `PATCH envs` +
   `restart`. Минус: ссылка = долгоживущий секрет, TTL 15 мин из спеки не соблюдается.
2. Потом: Traefik `forwardAuth` middleware → `GET /api/v1/cloud/screen/verify` на нашем бэкенде (одноразовый
   токен в query/cookie, TTL 15 мин, привязка к `uid`). Middleware описывается один раз в dynamic-config
   Traefik US-сервера (`coolify server proxy …` / UI «Proxy → Dynamic configurations»), а в compose тенанта —
   один label `traefik.http.routers.<router>.middlewares=ll-screen-auth@file`. Проверить, что label
   переживает парсер Coolify (issue #6939).

Что **не** меняется: `extension/cloud.js` (heartbeat/детект вытеснения), `POST /cloud/heartbeat`, watchdog-DM
в Telegram, `X-Client-Id: cloud:<id>` вне лимита устройств, ToS-граница §6 спеки.

## 5. План раскатки (конкретные шаги)

1. **Токены:** Hetzner Cloud API-токен (проект LoadLens) → `coolify cloud-token create`; новый Coolify API-токен
   `loadlens-backend` с правами write+deploy.
2. **Сервер:** `coolify server hetzner create --location ash --server-type ccx23 --image <ubuntu-24.04>
   --private-key <uuid> --cloud-init cloud-browser/cloud-init.yaml --validate` (или VM руками + `server add`).
   cloud-init: seccomp-профиль, `docker login ghcr.io`, ufw.
3. **DNS/домен:** Cloudflare `*.cloud.loadlens.krait.studio` → IP US-сервера; в Coolify у сервера wildcard domain.
4. **Образ:** `cloud-browser/Dockerfile` (из спайка + пункты §3) + GitHub Actions → `ghcr.io/bogbuk/loadlens-cloud-browser`.
5. **Первый тенант руками** (UI Coolify → New resource → Docker Compose Empty → вставить шаблон): залогиниться
   в DAT через экран → **ответ на Q2**; `docker inspect` → проверить `mem_limit/shm_size/security_opt/hostname`;
   сутки авто-пилота → **ответ на Q3** (живучесть сессии, RAM).
6. Только после «да» по Q2 — бэкенд `cloud/` на Coolify API, `extension/cloud.js`, popup, админка (по спеке).
7. Лид из Fontana — первый «Pro Cloud».

## 6. Риски, специфичные для варианта с Coolify

| риск | что делать |
|---|---|
| Coolify — единая точка отказа для деплоя тенантов (сам дашборд в Германии) | упавший Coolify не роняет контейнеры на US-сервере (они под Docker `restart: unless-stopped`); теряется только управление. Приемлемо |
| парсер Coolify молча выкинет `security_opt`/labels | шаг 5: `docker inspect` после первого деплоя; при проблеме — Raw Compose Deployment (но тогда labels/сеть Traefik пишем сами) |
| лимиты из UI не работают (#10676) | лимиты только в compose, UI не трогать |
| API по HTTP | вызывать из бэкенда по внутреннему адресу; не публиковать токен |
| цена сервера ×3 (Hetzner US) | стартовать с CCX23; при ≥10 тенантах пересчитать Vultr/DO/OVH US |
| Q2: DAT блокирует DC-IP | ответ на шаге 5; при «нет» — продукт в стол, мини-ПК остаётся рекомендацией |

## Источники

- Coolify API: [Create service](https://coolify.io/docs/api-reference/api/operations/create-service),
  [Start service](https://coolify.io/docs/api-reference/api/operations/start-service-by-uuid),
  [Create server](https://coolify.io/docs/api-reference/api/operations/create-server),
  [Authorization / права токена](https://coolify.io/docs/api-reference/authorization),
  [issue #4843 — docker_compose_raw base64](https://github.com/coollabsio/coolify/issues/4843)
- Coolify docs: [Docker Compose (magic vars, raw mode)](https://coolify.io/docs/knowledge-base/docker/compose),
  [Custom compose overrides](https://coolify.io/docs/knowledge-base/custom-compose-overrides),
  [Servers intro (remote/multi-server)](https://coolify.io/docs/knowledge-base/server/introduction),
  [Provision cloud server (Hetzner/DO/Vultr)](https://next.coolify.io/docs/core/infrastructure/servers/provision-cloud-server),
  [Traefik basic auth](https://coolify.io/docs/knowledge-base/proxy/traefik/basic-auth)
- Coolify issues: [#10676 лимиты UI на compose не применяются](https://github.com/coollabsio/coolify/issues/10676),
  [#6939 basic-auth labels теряются](https://github.com/coollabsio/coolify/issues/6939),
  [#6002 build-context compose](https://github.com/coollabsio/coolify/issues/6002)
- Hetzner: [Price adjustment 15 June 2026 (US-цены)](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/),
  [Locations (ash/hil — только Cloud)](https://docs.hetzner.com/cloud/general/locations/),
  [IPv4 pricing](https://docs.hetzner.com/general/infrastructure-and-availability/ipv4-pricing/),
  [обзор повышения цен](https://wz-it.com/en/blog/hetzner-price-increase-june-2026-cpx-ccx-alternatives/)
- neko: [Docker images](https://neko.m1k1o.net/docs/v3/installation/docker-images),
  [WebRTC (EPR/UDPMUX/TCPMUX)](https://neko.m1k1o.net/docs/v3/configuration/webrtc),
  [Reverse proxy](https://neko.m1k1o.net/docs/v3/reverse-proxy-setup),
  [Browsers customization (policies)](https://neko.m1k1o.net/docs/v3/customization/browsers),
  [chromium supervisord (--no-sandbox)](https://github.com/m1k1o/neko/blob/master/apps/chromium/supervisord.conf),
  [issue #605 persistent profile](https://github.com/m1k1o/neko/issues/605)
- linuxserver: [docker-chromium](https://docs.linuxserver.io/images/docker-chromium/),
  [baseimage-selkies (env, hardening)](https://docs.linuxserver.io/images/docker-baseimage-selkies/)
- Chromium sandbox в Docker: [seccomp chrome.json (Jess Frazelle)](https://blog.jessfraz.com/post/how-to-use-new-docker-seccomp-profiles/),
  [moby #42441 clone(CLONE_NEWUSER)](https://github.com/moby/moby/issues/42441)
- DAT: [How to unblock your account](https://one.support.dat.com/9-troubleshooting-2734b01a/how-to-unblock-your-account-ce2b9d27)
