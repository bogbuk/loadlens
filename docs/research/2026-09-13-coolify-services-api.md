# Coolify Services API — факты живой пробы (Task 13) и исходные предположения

Дата: 2026-09-13. Контекст: Task 6 (`backend/src/cloud/coolify.service.ts`), спека
`docs/superpowers/specs/2026-09-12-loadlens-cloud-browser-design.md`, фон — исследование
`docs/research/2026-09-12-cloud-browser-coolify-hetzner.md` (§1, «Контейнер на тенанта через API»).

## Почему нет живого прогона

Шаг 1 брифа (ручная проверка через `curl` с токеном write+deploy) **пропущен по решению
контроллера задачи**: токен с правами `write`+`deploy` ещё не создан — его создаёт владелец
в Coolify UI (Keys & Tokens → API tokens, имя `loadlens-backend`) и кладёт в `backend/.env` как
`COOLIFY_API_TOKEN`. Без токена вызывать API или ходить по ssh на `46.4.25.36` нельзя.

`coolify.service.ts` и его тесты реализованы на основе форм запроса/ответа, которые уже
зафиксированы в брифе и в исследовании от 2026-09-12 (там же описаны риски — issue #10676 про
лимиты ресурсов и issue #6939 про traefik-labels). Каждое предположение ниже помечено
**«to verify»** — их нужно перепроверить в Task 13 (Step 0, «рассадка первого тенанта»/rollout)
на живом сервере реальным токеном; если факты разойдутся — поправить `coolify.service.ts` и
`coolify.service.spec.ts` по факту, а не наоборот.

## ФАКТЫ с живого Coolify 4.3.18 (2026-09-13, Task 13, токен `loadlens-backend` read/write/deploy)

Проба выполнена скриптом `/root/ll-probe-create.sh` на 46.4.25.36; сервис-проба `ll-manual`
(uuid `ce9xqoxijxnongda412nyt9z`, проект LoadLens/production). Код `coolify.service.ts` приведён к фактам.

| вызов | факт |
|---|---|
| `POST /services` с `type` + `docker_compose_raw` | **422** `You cannot provide both service type and docker_compose_raw. Use one or the other.` → поле `type` НЕ шлём |
| `POST /services` (name, server_uuid, project_uuid, environment_name, docker_compose_raw=base64, instant_deploy=false) | **201** `{"uuid":"…","domains":["https://browser-<uuid>.cloud.loadlens.krait.studio"]}` — домен выдаётся сразу при create из Wildcard Domain сервера (`server_settings.wildcard_domain`), имя = `<service-name-in-compose>-<uuid>` |
| `POST /services/{uuid}/envs` `{key,value,is_preview:false}` | **409** `Environment variable already exists. Use PATCH request to update it.` — Coolify сам создал `NOVNC_PASSWORD` из `${NOVNC_PASSWORD}` в compose (плюс `SERVICE_FQDN_BROWSER`, `SERVICE_URL_BROWSER`, `SERVICE_FQDN_BROWSER_6080`, `SERVICE_URL_BROWSER_6080`) |
| `PATCH /services/{uuid}/envs` `{key,value,is_preview:false}` | **200**, возвращает объект переменной (`uuid`, `key`, `is_runtime:true`, `is_buildtime:true`, `is_literal:false`…). Код: PATCH, на 404 — фолбэк POST |
| `GET /services/{uuid}/envs` | список; `value` = `null` без ability `read:sensitive` (у токена её нет — это норма) |
| `GET /services/{uuid}` | ключи `applications[]`, `databases[]`, `status`, `server`, `environment`…; **`applications[0].fqdn`** = `https://browser-<uuid>.cloud…` — как в коде. Поле `docker_compose_raw` в ответе НЕТ. `status` до запуска = `exited` |
| `POST /services/{uuid}/start` | **200** `{"message":"Service starting request queued."}` — асинхронно; сбой pull видно только по `status` (осталось `exited`) и в UI |
| `DELETE /services/{uuid}?delete_volumes=true` | по OpenAPI 4.3.18 параметры `delete_configurations`, `delete_volumes`, `docker_cleanup`, `delete_connected_networks` (все boolean, дефолт true) — имя `delete_volumes` верное; живой прогон — после docker inspect |

**Запуск и жизненный цикл (после того как пакет GHCR сделан публичным, 13.09):**

| проверка | факт |
|---|---|
| `start` → контейнер | появился за <2 мин, имя `browser-<service-uuid>` (compose-сервис + uuid) |
| `docker inspect` (риск №6 спеки) | **все лимиты дошли:** `mem=2147483648 shm=536870912 pids=512 cpus=1e9 (1 CPU) host=ll-manual restart=unless-stopped`; volume `<service-uuid>_profile → /data` |
| env внутри контейнера | `NOVNC_PASSWORD` = значение из PATCH; `LL_INSTANCE_ID`, `START_URL`, `SCREEN` как в compose; Coolify добавил `SERVICE_FQDN_BROWSER_6080=<host>:6080` и `SERVICE_URL_BROWSER_6080=https://<host>:6080` (с портом!) — код FQDN из них НЕ берёт, берёт `applications[0].fqdn` без порта |
| `/ext/cloud.config.js` | `globalThis.LL_CLOUD = { mode: true, instanceId: "manual-1" }` — start-chromium.sh отработал |
| экран по HTTPS | `https://browser-<uuid>.cloud.loadlens.krait.studio/vnc.html` → 200, сертификат Let's Encrypt на точное имя (DNS-only запись + Traefik) |
| `POST …/stop` | 200 `Service stopping request queued.`; контейнер удалён (compose down), volume остаётся |
| `DELETE …?delete_volumes=true` | 200 `Service deletion request queued.`; через ~20 с контейнера и volume нет, `GET /services/{uuid}` → 404 |

`restart` живьём не гонялся (тот же action-эндпоинт, что start/stop) — проверится watchdog-сценарием на первом тенанте (Task 13, Step 9).

---

## Исходные предположения (до пробы; оставлены для истории)

## Предполагаемые формы запросов/ответов

### `POST /api/v1/services` — создание сервиса

Запрос:
```json
{
  "type": "docker-compose-empty",
  "name": "ll-<userId8>",
  "server_uuid": "f8xhhqagybtdjk14krvrp0kq",
  "project_uuid": "ocls09doyppd1f5ze0fsjj8r",
  "environment_name": "production",
  "docker_compose_raw": "<base64 compose>",
  "instant_deploy": false
}
```
Ответ (предположение): `{ "uuid": "<service-uuid>", "domains"?: [...] }`. Код читает только `uuid`.

**to verify:** сам `type: "docker-compose-empty"` — принимает ли Coolify 4.3.18 именно эту
строку (в списке 88 типов custom-compose может называться иначе); точная форма ответа (может
не быть `domains` вовсе, может быть обёрнута в другое поле).

### `POST /api/v1/services/{uuid}/envs` — задать переменную окружения

Запрос: `{ "key": "NOVNC_PASSWORD", "value": "<pass>", "is_preview": false }`. Ответ игнорируется
кодом (используется как `Promise<void>`).

**to verify:** метод (`POST` vs `PATCH`), точные имена полей (`key`/`value` vs `name`/`value`),
поведение при повторном вызове с тем же `key` (upsert ожидается, не дубликат).

### `GET /api/v1/services/{uuid}` — чтение сервиса, извлечение FQDN

Ответ (предположение): `{ "applications": [ { "fqdn": "https://browser-x.cloud.loadlens.krait.studio" } ] }`.
Код берёт `applications[0].fqdn`, режет схему (`https://`/`http://`) и берёт часть до первой
запятой (Coolify иногда отдаёт несколько доменов через запятую в одном поле `fqdn`).

**to verify:** путь `applications[0].fqdn` — это предположение из брифа и §1 исследования
(«магическая переменная `SERVICE_FQDN_BROWSER_6080`» и «`GET/PATCH /services/{uuid}/envs`»);
не проверено, что `fqdn` не пуст сразу после `instant_deploy: false` + `start` (может требовать
дополнительного времени на выпуск домена Traefik).

### `POST /api/v1/services/{uuid}/start|stop|restart` — управление жизненным циклом

Без тела, ответ игнорируется.

**to verify:** точные пути (могут быть `/start`, `/stop`, `/restart` либо action-параметр в одном
эндпоинте); поведение `restart`, когда сервис ещё не запущен.

### `DELETE /api/v1/services/{uuid}?delete_volumes=true` — удаление с volume

Query-параметр `delete_volumes=true` в URL. Ответ игнорируется.

**to verify:** имя параметра (`delete_volumes` vs `deleteVolumes`/`with_volumes`), удаляется ли
volume `profile` синхронно или это async job.

### `docker inspect` — переживают ли лимиты парсер Coolify

Компоуз (`renderCompose`) задаёт `mem_limit: 2g`, `shm_size: 512m`, `cpus: 1`, `pids_limit: 512`,
`hostname: ll-<userId8>` — согласно риску №6 спеки и issue #10676 (UI-лимиты Coolify на
compose-сервисы не применяются, но прямые ключи в самом compose должны сохраняться).

**to verify:** после первого реального деплоя выполнить
`docker inspect <container> --format 'mem={{.HostConfig.Memory}} shm={{.HostConfig.ShmSize}} pids={{.HostConfig.PidsLimit}} host={{.Config.Hostname}}'`
и подтвердить, что все четыре значения дошли до контейнера как заданы, а не были обнулены парсером.

## Предусловие для FQDN (не проверено, зафиксировано для Task 13)

В Coolify UI у сервера `localhost` должен быть задан Wildcard Domain
`https://cloud.loadlens.krait.studio` (DNS — Task 13, шаг 2) — без него `SERVICE_FQDN_BROWSER_6080`
не получит домен.

## Пропущенный скрипт ручной проверки (выполнить в Task 13, Step 0)

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

Записать результаты прямо в этот файл (заменить блоки «to verify» на факты), без токена в тексте.
