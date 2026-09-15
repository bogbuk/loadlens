# Спайк: пассивный перехват нативных Load Match Alerts DAT One

Date: 2026-09-15 · Status: done (вывод + рекомендация) · Task: `tasks/0029`

## Зачем

Лид (owner-op, Fontana) отвалился: «My friend got a warning from DAT for doing something
similar». Наш авто-пилот (reload каждые 60–120 с + авто-скролл до 40 страниц) генерирует
на порядок больше FindLoads, чем человек. Вопрос спайка: **каким каналом DAT One доставляет
в браузер свои Load Match Alerts, и можно ли их слушать пассивно** (ноль своих запросов),
чтобы заменить авто-пилот для 24/7-алертов.

## Метод

Живая сессия DAT One в Chrome пользователя (Chrome-MCP), зонды в MAIN-world страницы, плюс
оффлайн-анализ публичной статики: `one.dat.com` (773 чанка) и микрофронтенд поиска
`one.freight-search-v2-prod.dat.com` (remoteEntry + 258 чанков). Токены/заголовки/PII в отчёт
не попадали. Действия в UI: колокольчик на поиске вкл/выкл, SEARCH, временная вкладка поиска
Muncie, IN → Dallas, TX (70–134 результата), после пробы закрыта.

**Грабли зонда (важно для реализации):** патчи `window.fetch`/`EventSource`, поставленные
после загрузки страницы, SSE **не видят** — `event-source-polyfill` захватывает ссылку на
`fetch` в момент загрузки своего модуля. Первые 18 минут спайка дали ложный вывод «SSE не
открывается». Рабочий зонд — патч `ReadableStreamDefaultReader.prototype.read` (или патч
`fetch` строго на `document_start`, как делает наш `inject.js`).

## Как это устроено у DAT (код микрофронтенда, чанк `5379.*`, подтверждено вживую)

- **Канал — SSE (Server-Sent Events), не WebSocket.** На каждую вкладку поиска:
  `GET https://freight.api.prod.dat.com/notification/v3/liveQueryMatches/{searchId}`,
  `content-type: text/event-stream`, через `EventSourcePolyfill(url, {headers:
  {authorization: Bearer <token>}})` (fetch + ReadableStream). В бандлах нет `wss://` и
  `new WebSocket`. Keep-alive кадр `:Keep-Alive` каждые 10 с, первый кадр `retry:3000`.
  На тестовом аккаунте одновременно висело 5 потоков (4 сохранённых вкладки + временная),
  включая поиски с 1300–5000 результатами.
- **Подписка регистрируется самим FindLoads**: в variables идёт
  `criteria.delivery.notify = true` (это `liveMatching`). Отдельной Start-мутации нет;
  есть `StopLoadMatchAlerts(searchId)` — при смене/закрытии поиска. Все SSE закрываются на
  `beforeunload` и LOGOUT.
- **События**: `LOAD_MATCH_CREATED` / `LOAD_MATCH_UPDATED` / `…CANCELLED` (+ служебное
  `__IMMINENT_DISCONNECT`). Кадр: `id: <searchId>:<ts>`, `event: …`, `data: {json}`.
  Снятый `LOAD_MATCH_UPDATED` (1,5 КБ, redacted) содержит: `isActive`,
  `assetInfo.{postingId, equipmentType, equipmentDisplayName, origin{placeId, city, county,
  stateProv, postalCode, lat, lon}, destination{…}, capacity{fullPartial, maximumLengthFeet,
  maximumWeightPounds}}`, `availability.{earliestWhen, latestWhen}`, `tripLength.{miles, method}`,
  `originDeadheadMiles/destinationDeadheadMiles.{miles, method}`, `estimatedRatePerMile`,
  `postingExpiresWhen`, `qualificationSettings.*`, `isFactorable`, `isAssurable`, `isBookable`,
  `isNegotiable`, `isFromPrivateNetwork`, `isTrackingRequired`, `isRedacted`,
  `redactionReasons[]`, `resultId`, `servicedWhen`, `presentationDate`. Для нередактированных
  грузов клиент DAT дополнительно читает `posterInfo.contact.{phone,email}` (см.
  `adaptMatchAlertToLoadSearchResult`) — т.е. форма = элемент `findLoads.results`, наш
  `DAT_GQL`-парсер применим почти без правок.
- **Гейты на клиенте**: `canGetFullLiveMatches() = userPermissions.canMultipleSearch &&
  !canMultipleSearchLow && !canMultipleSearchLowPlus` — по прайсу DAT это число вкладок
  поиска (Standard 2 / Enhanced 3 / Pro 10), т.е. **полные live matches от Pro и выше**
  (Standard/Enhanced — только счётчики, `canGetLiveMatchCounts = !BasicUser`).
  ≥ 1000 результатов → `maxNotificationsReached` (клиент перестаёт добавлять в выдачу;
  поток при этом наблюдался живым). Пагинация (`cursor`) выключает `liveMatching`.
  Колокольчик «Enable alarms for this search» — **чисто клиентский флаг `alarmEnabled`**
  (звук при событии), в сеть ничего не шлёт.
- Не путать: `visibility.api.dat.com/tracking-realtime-updates-service/v1/subscriptions/{id}/sse`
  — RTU трекинга отгрузок. Notification-center поллит `notification/v1/preferences` +
  `v2/eventGroups` раз в 5 мин, `usurp/v1/session/…/status` раз в ~2,5 мин.

## Выводы

1. **Пассивный перехват возможен и ToS-чист по нашему критерию**: `inject.js` уже патчит
   `fetch` на `document_start`, т.е. полифил DAT захватывает именно нашу обёртку. Достаточно
   для ответов с `text/event-stream` читать `res.clone().body`, парсить кадры `event:`/`data:`
   и слать в `content.js` тем же `postMessage`, что FindLoads. Своих запросов ноль, авто-пилот
   и авто-скролл для алертов не нужны, задержка — секунды (настоящий real-time, чего просил лид).
2. **Ограничения канала:** тариф DAT от Pro (10 вкладок), вкладка с поиском должна быть
   открыта (SSE живёт в странице), один поток на вкладку поиска (Pro — до 10), redacted-события
   без контакта брокера (контакт есть в нередактированных).
3. Нарратив «DAT сам шлёт вам матчи, мы только слушаем» честный и безопасный; для Standard/
   Enhanced единственный 24/7-путь остаётся авто-пилот, поэтому снижение его футпринта всё
   равно нужно как фолбэк.

## Рекомендация

- Реализовать SSE-tee в `inject.js` за флагом (`ll_sse_alerts`, ~60–80 строк) + маппинг
  события → `Load` через `DAT_GQL` + подача в `LLALERT`/`LLRULES` (те же правила Telegram).
  Тест: аккаунт пользователя (Company, ≥4 вкладок — live matches есть), узкий поиск.
- Снизить футпринт авто-пилота как фолбэк: авто-скролл всех страниц по умолчанию выкл
  (или ≤ 3 страниц), интервал ≥ 3–5 мин, пауза после N часов без активности.
- Заявку в DAT Integrations Partner подать как долгий трек (см. CLAUDE.md).

## Throwaway

Зонды жили только в памяти страницы (пропали при закрытии вкладки), скачанные бандлы —
в scratchpad сессии. В репозиторий код спайка не попадал.
