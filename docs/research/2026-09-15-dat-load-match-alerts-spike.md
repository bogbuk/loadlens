# Спайк: пассивный перехват нативных Load Match Alerts DAT One

Date: 2026-09-15 · Status: done (вывод + рекомендация) · Task: `tasks/0029`

## Зачем

Лид (owner-op, Fontana) отвалился: «My friend got a warning from DAT for doing something
similar». Наш авто-пилот (reload каждые 60–120 с + авто-скролл до 40 страниц) генерирует
на порядок больше FindLoads, чем человек. Вопрос спайка: **каким каналом DAT One доставляет
в браузер свои Load Match Alerts, и можно ли их слушать пассивно** (ноль своих запросов),
чтобы заменить авто-пилот для 24/7-алертов.

## Метод

Живая сессия DAT One в Chrome пользователя (Chrome-MCP), зонды в MAIN-world страницы:
патчи `WebSocket`/`EventSource`/`fetch`/`XMLHttpRequest` (только URL без query, имя
GraphQL-операции, ключи ответа, размеры чанков стрима), плюс оффлайн-анализ публичной
статики: `one.dat.com` (773 чанка) и микрофронтенд поиска
`one.freight-search-v2-prod.dat.com` (remoteEntry + 258 чанков). Токены/заголовки/PII в
отчёт не попадали. Действия в UI: включить/выключить колокольчик на поиске, SEARCH,
временная вкладка поиска Muncie, IN → Dallas, TX (134 и 70 результатов), после пробы закрыта.

## Как это устроено у DAT (из кода микрофронтенда, чанк `5379.*`)

- **Канал — SSE (Server-Sent Events), не WebSocket.** Соединение:
  `GET {notificationsUrl}/v3/liveQueryMatches/{searchId}`, где
  `notificationsUrl = https://freight.api.prod.dat.com/notification`. Открывается через
  `EventSourcePolyfill(url, {headers: {authorization: Bearer <token>}})` — polyfill
  использует `fetch` + `ReadableStream` (в бандлах нет `wss://`/`new WebSocket` вообще).
- **Подписка регистрируется неявно самим FindLoads**: в variables идёт
  `criteria.delivery.notify = true` (это `liveMatching`). Отдельной Start-мутации нет;
  есть `StopLoadMatchAlerts(searchId)` — шлётся при смене/закрытии поиска. Все SSE
  закрываются на `beforeunload` и LOGOUT.
- **События**: `Create` / `Update` / `Cancel` (enum для грузов) + служебное
  `__IMMINENT_DISCONNECT`. `data` — JSON того же вида, что элемент `findLoads.results`
  (`assetInfo.postingId`, `posterInfo.contact.{phone,email}`, `isRedacted`), клиент
  оборачивает его `adaptMatchAlertToLoadSearchResult({...data, fromMatchAlert: true})`.
  Значит, наш `DAT_GQL`-парсер применим почти без изменений.
- **Гейты на клиенте**:
  - `canGetFullLiveMatches() = userPermissions.canMultipleSearch && !canMultipleSearchLow
    && !canMultipleSearchLowPlus` — уровень тарифа DAT; без него live-подписка не
    открывается (`canGetLiveMatchCounts() = !BasicUser` — только счётчики).
  - ≥ 1000 результатов → `maxNotificationsReached` → SSE закрывается, пагинация
    (`cursor`) тоже выключает `liveMatching`.
  - Колокольчик «Enable alarms for this search» — **чисто клиентский флаг `alarmEnabled`**
    (звук при событии), в сеть ничего не шлёт.
- Не путать: `visibility.api.dat.com/tracking-realtime-updates-service/v1/subscriptions/{id}/sse`
  — это RTU трекинга отгрузок, к грузам не относится. Notification-center поллит
  `notification/v1/preferences` + `v2/eventGroups` раз в 5 мин, `usurp/v1/session/…/status`
  раз в ~2,5 мин — это единственный фоновый трафик страницы.

## Что наблюдалось на тестовом аккаунте (localStorage: user type = Paid)

За 18 минут и 5 поисков (2052 / 1308 / 4985 / 134 / 70 результатов), с колокольчиком и без:
`FindLoads` уходит с `notify=true`, но **ни одного соединения `liveQueryMatches` не открылось**
(ни fetch, ни XHR, ни EventSource, ни WebSocket), и ни одного match-события не пришло.
Вывод: у этого аккаунта нет права `canGetFullLiveMatches` (тариф «Low/LowPlus»).
Какой именно тариф DAT даёт live matches — из кода не видно, нужно проверить на
аккаунте лида/клиента.

## Выводы

1. **Технически перехват тривиален и ToS-чист по нашему критерию**: `inject.js` уже
   патчит `fetch`; достаточно `res.clone().body` → читать поток `text/event-stream`,
   парсить `event:`/`data:` и слать в `content.js` тем же `postMessage`, что FindLoads.
   Своих запросов ноль, авто-пилот/авто-скролл для алертов не нужны, задержка —
   секунды (реальный real-time, чего просил лид).
2. **Но канал существует только для аккаунтов с правом live matches, для поисков
   < 1000 результатов и пока вкладка открыта.** На тестовом аккаунте слушать нечего.
   Для остальных пользователей 24/7-алерты по-прежнему возможны только через авто-пилот.
3. Следствие для продукта: «DAT сам вам шлёт, мы только слушаем» — честный и
   безопасный нарратив, но он работает как **Pro-функция для DAT-тарифов с live
   matches**, а не как замена авто-пилота для всех.

## Рекомендация

- Реализовать SSE-tee в `inject.js` за флагом (`ll_sse_alerts`), ~60–80 строк +
  маппинг события → `Load` через `DAT_GQL` (форма совпадает с `findLoads.results`).
  Проверить на аккаунте, у которого DAT показывает live matches (спросить у следующего
  лида его тариф; либо временно поднять тариф тестового аккаунта).
- Параллельно снизить футпринт авто-пилота как фолбэк для остальных: авто-скролл всех
  страниц по умолчанию выкл (или ≤ 3 страниц), интервал ≥ 3–5 мин, пауза после N часов
  без активности пользователя.
- Заявку в DAT Integrations Partner подать как долгий трек (см. CLAUDE.md).

## Throwaway

Зонды жили только в памяти страницы (пропали при закрытии вкладки), скачанные бандлы —
в scratchpad сессии. В репозиторий код спайка не попадал.
