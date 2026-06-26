# Premium-only чтение бэкенда (Pro-JWT ИЛИ API-KEY) — дизайн

Date: 2026-06-26
Status: approved

## Контекст

Сейчас read-эндпоинты бэкенда открыты — расширение дёргает их анонимно (без auth-заголовка):
`GET /lanes/:o/:d`, `GET /lanes`, `GET /markets/:m/strength`, `GET /loads`, `GET /loads/near`,
`GET /geo/distance`, `GET /rates`, `GET /brokers/:mc/reputation`. JWT используется только для
аккаунта/парка/Telegram; план — в `User.plan` (`'pro'`/free), гейт — `ProGuard`.

Цель: **читать крауд-данные могут только Premium.** Premium доказывается двумя эквивалентными
способами (гард пропускает при любом):

- **(A) Pro-JWT** — залогиненный пользователь с `plan==='pro'` (Bearer). Этим путём ходит расширение.
- **(B) валидный API-KEY** — из ENV-списка `API_KEYS` (много ключей), заголовок `X-API-Key`.
  «Ключ = пропуск» для программных/партнёрских клиентов без логина.

Нет ни валидного Pro-JWT, ни валидного ключа → **403**.

## Бэкенд

### `PremiumReadGuard` (новый, `backend/src/common/premium-read.guard.ts`)

`CanActivate`. Порядок проверок:

1. `X-API-Key` заголовок: если непустой и принадлежит набору валидных ключей → **пропуск** (`true`).
2. Иначе `Authorization: Bearer <token>`: верифицировать через `JwtService` (как `JwtAuthGuard`:
   `payload.type === 'access'`), загрузить `User.findByPk(payload.sub)`; если `user.plan === 'pro'`
   → положить `req.user = { userId }` и **пропуск**.
3. Иначе `throw new ForbiddenException('Premium-доступ к чтению требует Pro-аккаунт или API-ключ')`.

Зависимости гарда — `JwtService` и модель `User` (как у `JwtAuthGuard`/`ProGuard`).

### Набор ключей (`backend/src/common/api-keys.ts`)

`parseApiKeys()` читает `process.env.API_KEYS`, сплит по запятой, `trim`, отбрасывает пустые →
возвращает `Set<string>`. Гард зовёт `parseApiKeys()` (или хелпер `isValidApiKey(key)`) на каждом
запросе (дёшево; ENV меняется только при рестарте). Пустой/неуказанный `API_KEYS` → набор пуст →
путь (B) выключен, остаётся только Pro-JWT (поведение фича-флага, как `TELEGRAM_BOT_TOKEN`).

Сравнение ключа — обычное членство в `Set` (ключи — высокоэнтропийные 64-симв. секреты; constant-time
не требуется для этого класса, YAGNI; при желании — отдельный цикл, но в scope не входит).

### Куда вешается (только GET-чтение)

- Контроллеры только с GET → гард на уровне контроллера: `lanes`, `markets`, `geo`, `rates`.
- Смешанные (POST-инжест открыт) → гард на уровне метода только на GET:
  - `loads`: `@UseGuards(PremiumReadGuard)` на `GET near` и `GET` (корневой). `POST /loads` — **без гарда**.
  - `brokers`: гард на `GET :mc/reputation`. `POST /brokers/reports` — **без гарда**.
- **Не трогаем:** `auth`, `users`, `drivers`, `telegram` — свой `JwtAuthGuard`/`ProGuard`/админ.

### Wiring модулей

Гарду нужны `JwtService` и `SequelizeModule.forFeature([User])`. Чтобы не дублировать в каждом
read-модуле, создаём `CommonAuthModule` (`backend/src/common/common-auth.module.ts`): импортирует
`JwtModule` (с тем же `secret`, что в `AuthModule`) + `SequelizeModule.forFeature([User])`,
объявляет и **экспортирует** `PremiumReadGuard`. Каждый read-модуль (`lanes`/`markets`/`loads`/
`geo`/`rates`/`brokers`) импортирует `CommonAuthModule`. (Альтернатива — сделать `JwtModule` глобальным;
выбран явный общий модуль ради локальности.)

## Расширение

### Auth-заголовок на read-вызовах (`extension/api.js`)

Новый внутренний хелпер `authHeader()`: `const a = await getAuth(); return a?.accessToken ? { Authorization: \`Bearer ${a.accessToken}\` } : {};`

Read-функции добавляют `headers: { ...(await authHeader()) }` к своему `fetch`:
`getLane`, `getLoadsByOrigin`, `getLoadsNear`, `getBrokerReputation`, `getMarket`, `getDistance`,
`getDiesel`. Поведение при ответе не-`ok` (403 для не-Premium) — **существующее**: каждая функция уже
ловит `!res.ok`/исключения и возвращает фолбэк (`null`/`[]`/дефолтный дизель). Расширение деградирует
к локальному скорингу без крауд-данных.

Токен-рефреш на 401 для read-путей в scope **не включаем** (YAGNI): истёкший access-токен → 403 →
фолбэк; ближайший authed-вызов (`getMe`/`authedCall`) обновит токен штатно. Если на практике окажется
нужно — отдельный цикл.

### Следствие продукта

Free/анонимные/не-Pro пользователи теряют крауд-данные: медианы lane, силу рынков, onward-плечи
цепочек (`getLoadsByOrigin`/`getLoadsNear`), дизель с бэка (фолбэк $3.95). Локальный скоринг по
видимой выдаче (true $/mi, HOS) продолжает работать. Это и есть «читать могут только Premium».
POST-инжест (`sendLoads`, `reportBroker`) остаётся анонимным — крауд-база пополняется от всех.

## Конфигурация и безопасность

- **Реальный ключ в репозиторий не коммитим.** Только ENV: Coolify (`API_KEYS`) + локальный `.env`
  (в `.gitignore`). В `backend/.env.example` — пустой `API_KEYS=` с комментарием формата `key1,key2`.
- Coolify: добавить env `API_KEYS=<секрет(ы)>` в production-окружение (новый деплой подхватывает
  только свежий env — `app env sync` + push, по скиллу coolify-deploy).
- `CLAUDE.md`: задокументировать новый гейт чтения (раздел «Конвенции» + таблица модулей).

## Тестирование

`backend/src/common/premium-read.guard.spec.ts` (jest, мок `JwtService` + `User` модель + `process.env.API_KEYS`):

1. Валидный `X-API-Key` из набора → `true` (JWT не проверяется).
2. Неизвестный `X-API-Key` без Bearer → `ForbiddenException`.
3. Pro-JWT без ключа → `true`, `req.user.userId` выставлен.
4. Валидный access-JWT, но `plan!=='pro'` → `ForbiddenException`.
5. Пустой `API_KEYS` + любой `X-API-Key` → `ForbiddenException` (путь B выключен).
6. Ни ключа, ни токена → `ForbiddenException`.

`parseApiKeys` — отдельные кейсы (запятые/пробелы/пустые/незаданная переменная → пустой Set).

Расширение (`api.js`) — JS-логика `authHeader()` тривиальна и зависит от `chrome.storage`; покрытие —
ручной проверкой (залогинен Pro → читает; разлогинен → 403 → локальный скоринг). Автотест не делаем
(нет jsdom/chrome-моков для api.js; в проекте api.js не покрыт юнит-тестами).

## Вне scope

Ротация/выдача ключей через UI или БД (только ENV-список); rate-limiting по ключу; токен-рефреш на
read-путях; гейтинг POST-инжеста; изменение JWT-эндпоинтов аккаунта/парка/Telegram.
