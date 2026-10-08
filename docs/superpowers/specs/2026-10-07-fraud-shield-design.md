# Fraud Shield — дизайн

Дата: 2026-10-07 · Задача: `tasks/0058` · Ветка: `fraud-shield`

## Зачем

Фрод (double-brokering, «приманки», брокеры-однодневки) — боль №1 диспетчеров в 2026. Диспетчер должен
увидеть «этот брокер подозрителен» ДО звонка. Уже есть `LLSCORE.redFlags` (ставка выше рынка, нет MC,
bait-комбо, плохая crowd-репутация), чипы кредита/DTP и crowd-отзывов. Fraud Shield добавляет три
независимых сигнала:

1. **Лицензия брокера (FMCSA)** — действует ли, сколько ей лет, были ли приостановки/отзывы.
2. **Перепосты** — один брокер постит один lane снова и снова (признак приманки) — из нашей крауд-БД;
   этого longitudinal-сигнала нет у Highway/Carrier Assure.
3. **Размер крауда** — «рынок $2.41 · 37 reports»: видно, насколько медиане можно верить.

## Тариф (решение 2026-10-07, вариант B)

Лицензия и перепосты — **бесплатно всем** (включая аноним): это acquisition-крючок, а нам почти
бесплатно (кэш по MC). Эндпоинт открыт, без `PremiumReadGuard`, со своим лимитом 600/мин.
«N reports» — Pro: число приходит из `GET /lanes/:o/:d`, который уже за Premium-гардом.

## Источники данных FMCSA

Проверено вживую 2026-10-07.

| источник | что даёт | ключ | ограничения |
|---|---|---|---|
| QCMobile `GET /qc/services/carriers/docket-number/{n}` → `dotNumber`; `GET /qc/services/carriers/{dot}` → `allowedToOperate` (Y/N), `brokerAuthorityStatus`/`commonAuthorityStatus`/`contractAuthorityStatus` (A/I/N) | **текущий** статус, авторитетно | `webKey` (бесплатно, mobile.fmcsa.dot.gov через Login.gov) | нет даты выдачи лицензии |
| data.transportation.gov `9mw4-x3tu` «AuthHist – All With History» (SODA, без ключа): `docket_number` (`MC384859`), `mod_col_1` (`BROKER`/`PROPERTY BROKER`/…), `original_action_desc`, `orig_served_date` (`MM/DD/YYYY`), `disp_action_desc`, `disp_served_date` | история: дата выдачи, отзывы | нет | **заморожен** с 05.2026 |
| `yu5v-wbh6` «Motus AuthHist – All With History»: `docket_number`, `op_auth_type` (`Broker of Property (Except Household Goods)`), `op_auth_status` (`Active`/`Inactive`), `reason`, `status_change_date` (`YYYYMMDD`) | события после перехода FMCSA на Motus, обновляется ежедневно | нет | неполный: только сущности/события Motus |

**Ключевое ограничение:** исторические датасеты — журнал событий, не реестр. Отсутствие брокерской записи
НЕ означает отсутствие лицензии. Поэтому:

- **Текущий статус** (high-флаги) — **только из QCMobile**. Нет `FMCSA_WEBKEY` → статусных флагов нет.
- **Возраст и инциденты** (med-флаги) — из исторических датасетов, **только при найденной брокерской
  записи**. Не нашли → `null`, флага нет.

Принцип: лучше промолчать, чем ложно пометить крупного брокера как фрод.

## Бэкенд — модуль `backend/src/shield/`

### `GET /api/v1/brokers/:mc/shield?o=<market>&d=<market>&e=<equip>`

Открыт (без гардов авторизации), свой лимит `@Throttle` 600/мин (глобальные 120/мин малы: расширение спрашивает по каждой паре брокер+lane на странице). `o/d/e` опциональны — без них нет `repost`.
MC нормализуется существующим `normalizeMc` (цифры). Нецифровой MC → 400.

```jsonc
{
  "mc": "384859",
  "authority": {                 // null: источники недоступны и кэша нет
    "status": "active" | "inactive" | "carrier_only" | "not_found" | null,  // null = нет FMCSA_WEBKEY
    "allowedToOperate": true | false | null,
    "grantedAt": "2000-07-12" | null,    // самая ранняя брокерская выдача (GRANTED) из истории
    "ageDays": 9218 | null,
    "incidents12m": 0,                    // приостановки/отзывы брокерской лицензии за 12 мес; null — истории нет
    "checkedAt": "2026-10-07T10:00:00Z"
  },
  "repost": { "count": 6, "days": 4, "windowDays": 14 } | null
}
```

`status` (из QCMobile):
- docket не найден → `not_found`;
- `brokerAuthorityStatus === 'A'` → `active` (при `allowedToOperate === 'N'` → `inactive`);
- брокерская не `A`, но common/contract `A` → `carrier_only` (перевозчик постит груз — double-brokering);
- иначе → `inactive`.

### Компоненты

- `authority.ts` — **чистые** функции: `deriveStatus(qcCarrier|null, found)`, `deriveHistory(authHistRows,
  motusRows, now)` → `{grantedAt, ageDays, incidents12m}`. Брокерские типы: `mod_col_1` ∈ {`BROKER`,
  `PROPERTY BROKER`}, `op_auth_type` начинается с `Broker of Property`. Инцидент = событие
  `INVOLUNTARY REVOCATION`/`REVOKED`/`*SUSPENSION*`/`Inactive` с датой в последние 365 дней.
- `fmcsa.client.ts` — fetch к QCMobile (если `FMCSA_WEBKEY`) и двум SODA-датасетам (`?docket_number=MC<n>`),
  таймаут 5с, ответы параллельно; сбой одного источника не роняет остальные.
- `fmcsa-authority.model.ts` — таблица `fmcsa_authority`: `mc` TEXT PK, `data` JSONB, `fetched_at` TIMESTAMPTZ.
  TTL: 24ч (найден), 6ч (`not_found`). Источник лёг → отдаём протухший кэш; кэша нет → `authority: null`.
  Конкурентные промахи по одному MC дедупятся in-flight Map'ом в сервисе.
- `repost.ts` — запрос к `loads`: `COUNT(DISTINCT load_id)`, `COUNT(DISTINCT first_seen::date)` где
  `broker_mc = :mc AND origin_market = :o AND dest_market = :d AND equipment = :e AND first_seen > now() - 14d`.
  Наружу — только числа. Индекс `(broker_mc, first_seen)` — `CREATE INDEX IF NOT EXISTS` в `main.ts`.
- `shield.service.ts` / `shield.controller.ts` / `shield.module.ts`.

Env: `FMCSA_WEBKEY` (опц.; без него — только история и перепосты). В `.env.example` и CLAUDE.md.

## Флаги — `shared/scoring.js`

`redFlags(load, ctx)` получает `ctx.shield` (ответ эндпоинта). Пороги — в `opts`.

| код | условие | sev | label |
|---|---|---|---|
| `authority_inactive` | `status === 'inactive'` | high | `FMCSA: broker authority inactive` |
| `carrier_brokering` | `status === 'carrier_only'` | high | `FMCSA: carrier authority only — possible double-brokering` |
| `authority_not_found` | `status === 'not_found'` | high | `FMCSA: MC not found` |
| `new_authority` | `ageDays < 180` (`< 90` → high) | med/high | `new broker authority: 45 days` |
| `authority_incidents` | `incidents12m > 0` | med | `FMCSA: 2 suspensions/revocations in 12 mo` |
| `reposted` | `count >= 4 && days >= 3` | med | `reposted 6× over 4 days` |

`LLSCORE.shieldBadge(shield)` → `{ level: good|warn|risk|unknown, text }` для чипа:
`risk` — любой high-флаг выше; `warn` — `ageDays < 365` или инциденты; `good` — `active` и ≥1 год;
`unknown` — нет данных. Текст: `🛡 2y ✓` / `🛡 45d` / `🛡 ✗` / `🛡 ?`.

После правки — `npm run sync:shared`.

## Расширение

- `api.js`: `LLAPI.getShield(mc, o, d, e)` — без требования логина (Bearer шлётся, если есть).
- `content.js`: `shieldCache: Map<mc|o|d|e, shield>` по образцу `repCache` — ленивые запросы для
  накопленных грузов, один запрос на ключ за сессию вкладки (`shieldRequested`), сбой → нет записи (без ретраев).
  `redFlags` получает `shield` в обоих местах вызова (строковые бейджи и карточка детали).
- Чип `🛡` в полосе брокера (рядом с кредитом и crowd-репутацией), title — расшифровка.
- `laneCache` не меняет формат (5 читателей); рядом — `laneCountCache: Map<laneKey, n>`, заполняется в том
  же `getLane().then`; в lookup view-model добавляется `laneCountOf(o,d,e)`; `view-model.js` печатает
  «market $2.41 · 37 reports» (только когда медиана есть).
- Telegram-алерты и правила — без изменений (YAGNI; кандидат на следующую итерацию: правило «skip flagged»).

## Тесты

- `authority.spec.ts` — фикстуры реальных форм ответов: активный брокер (QC `A`), `allowedToOperate=N`,
  carrier_only, docket не найден, без webKey (`status: null`); история: дата выдачи из AuthHist,
  событие Motus, инцидент 2 месяца назад vs 2 года назад, отсутствие брокерской записи → `null`.
- `shield.service.spec.ts` — кэш свежий/протухший, источник упал → протухший кэш, кэша нет → `authority: null`,
  in-flight дедуп.
- `repost.spec.ts` — на реальном Postgres (`LL_TEST_DATABASE_URL`, иначе skip), как `loads.ingest-concurrency`.
- `shared` — `redFlags` новые коды и пороги, `shieldBadge`.
- `view-model` — «N reports».

## ToS / правовое

FMCSA QCMobile и data.transportation.gov — публичные государственные данные. К DAT новых запросов
нет. Перепосты считаются по уже собранной крауд-БД; наружу — только счётчики, без постингов и PII.

## Поправки после ревью ветки (2026-10-08)

- `reposted` — sev `info`: показывается в списке флагов карточки, но не поднимает 🚩 (`redFlagLevel` считает только med/high).
- `not_found` при найденной брокерской истории выдачи → med «FMCSA lookup mismatch»; high — только без истории.
- `deriveStatus`: брокерский статус не A/I/N → `null` (дрейф схемы QCMobile не превращается в массовые high-флаги).
- TTL найденного брокера 12ч (было 24ч; решение 08.10). Частичный результат кэшируется на 30 мин (`partial`), а не не кэшируется: протухший ключ не даёт веер запросов.
- Бюджет 300 походов в FMCSA в минуту на процесс; сверх — протухший кэш или `null`.
- Глобальный троттлер считает клиента по `CF-Connecting-IP` (за Cloudflare `req.ip` — адрес прокси).
- Расширение повторяет неудавшийся запрос shield через 60 с.

## Поправка 2026-10-08: статус — из реестра L&I, не из QCMobile

FMCSA закрывает `mobile.fmcsa.dot.gov` целиком для не-US IP: 403 на главную и на API с любым ключом — и из Молдовы,
и с прод-сервера в Германии. QCMobile заменён датасетом `6eyk-hxee` «Carrier – All With History» (реестр L&I,
обновляется ежедневно, без ключа): `broker_stat`/`common_stat`/`contract_stat` (A/I/N) — те же значения, что
`brokerAuthorityStatus`/`commonAuthorityStatus`/`contractAuthorityStatus`. Реестр полный (~25k активных брокеров),
поэтому отсутствие строки = `not_found`. Поле `allowedToOperate` (его в реестре нет) из ответа убрано, `FMCSA_WEBKEY` не нужен.
Ранее приведённый пример «MC411443 — крупный брокер без брокерской записи» ошибочен: это перевозчик
(Mega Trucks and Equipment) без брокерской лицензии. Таблица источников и упоминания QCMobile выше — история решения.

## Вне объёма

Страховка брокера (BOC-3/BMC-84 bond), FMCSA census (телефоны/адрес для сверки с контактом в посте),
алерты по флагам, отдельная страница «проверить MC» на лендинге (кандидат в SEO-инструмент).
