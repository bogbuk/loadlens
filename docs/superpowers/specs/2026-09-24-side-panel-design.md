# Side Panel: попап + панель грузов → `chrome.sidePanel`

Date: 2026-09-24
Status: approved (дизайн), ждёт план

## Цель

Перенести весь UI LoadLens с поверхности страницы DAT и из попапа в штатную боковую панель Chrome
(MV3 `chrome.sidePanel`, Chrome 116+). Панель живёт рядом с выдачей, не перекрывает таблицу DAT,
ширину меняет пользователь, один UI вместо двух (попап + `#ll-panel`).

## Решения (согласованы)

| Вопрос | Решение |
|---|---|
| Объём | Попап **и** панель грузов (`#ll-panel`) уезжают в side panel |
| In-page | `#ll-panel` удаляется; на странице остаются построчные бейджи, FAB и меню отзыва о брокере. FAB открывает side panel |
| Где «мозг» | **Тонкая панель (A):** `content.js` по-прежнему считает скоринг/цепочки/API/кэши и шлёт сериализуемый снапшот; панель только рисует и шлёт команды |
| Карточка груза | Переезжает в side panel; клик по бейджу (`ⓘ details`, чип 👤) открывает её там |

Отвергнуто: (B) толстая панель — дублирование скоринга (алерты должны работать без открытой панели,
значит скоринг во вкладке остаётся всё равно) и пересчёт при каждом переключении вкладки;
(C) пересылка готового HTML — хак без границ ответственности.

## 1. Манифест и точки входа

- `permissions`: + `sidePanel` (без install-warning). `tabs` НЕ нужен — URL DAT/Truckstop-вкладок
  доступны через уже имеющиеся `host_permissions`.
- `side_panel.default_path: "sidepanel.html"`, `minimum_chrome_version: "116"`.
- `action.default_popup` удаляется (иначе клик по иконке открывает попап, а не панель).
- `background.service_worker: "background.js"` (новый файл):
  - `onInstalled` → `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`;
  - `runtime.onMessage` `{type:"open-panel", detailLoadId?}` от content → `sidePanel.open({ tabId: sender.tab.id })`
    (без `pendingDetail`: открытую карточку помнит сама вкладка — `detailLoadId` в content.js — и отдаёт её
    в первом же снапшоте, когда панель подключится).
- `sidepanel.html` — две вкладки UI:
  - **Loads** — выдача активной DAT-вкладки (бывший `#ll-panel`);
  - **Settings** — бывший попап целиком. `popup.js` переиспользуется (монтируется в контейнер вкладки);
    убрать `body{width:280px}`, вёрстка резиновая. `popup.html` удаляется.

## 2. Протокол панель ↔ вкладка

- Соединение открывает **панель**: `chrome.tabs.connect(activeTabId, { name: "ll-panel" })`.
  Переподключение на `tabs.onActivated` и `tabs.onUpdated(status=complete)` текущего окна.
  Вкладка не DAT/Truckstop (или content-скрипт не отвечает) → заглушка «Open a DAT One search».
  Почему панель-инициатор: подключена только активная вкладка — фоновые вкладки авто-пилота не
  тратят CPU на сериализацию.
- `content.js` `runtime.onConnect` (name `ll-panel`) — держит `panelPort`; `onDisconnect` → `null`.
  На каждый `render()` при живом порте шлёт `{type:"snapshot", data}`.
- **Снапшот** строит чистый модуль `extension/view-model.js` (`LLVIEW.build(state)`), только данные:
  `{ board, loadsCount, equipFilter, start, diesel, cpm, autoRefresh:{on, cloud}, sseLive, sort,
  sortFields, drivers, activeDriverId, hintsOff, chains[], deals[], detail|null }`.
  Цепочки/плечи — уже с посчитанными полями для рендера (route, meta, live/forecast, resultId, chips,
  median, freshness, density, strength). Никакого HTML.
- **Команды** панель → вкладка `{type:"cmd", cmd, ...args}`:
  `setDriver{id}`, `setCpm{value}`, `setStart{market}`, `setAutorefresh{on}`, `setSort{field?,dir?}`,
  `scrollToRow{resultId}` → ответ `{type:"scrollResult", ok}`, `openDetail{loadId}`, `closeDetail`,
  `exportCsv`, `setHintsOff{on}`. Состояние раскрытых цепочек (`expandedChainSig`) — локально в панели.
- Команда меняет состояние во вкладке → `render()` → новый снапшот (однонаправленный поток).

## 3. Рендер в панели

- `extension/panel/render.js` (`LLPANEL`) — чистые функции «снапшот → HTML-строка»: шапка
  (driver select, cfg-строки, sort, auto-refresh, ● live, 🙈), `chainCard`, `legRow`, `liveChips`,
  Hot loads, карточка детали. Переносятся из `content.js` вместе с `esc`/`money`/форматтерами.
- `extension/sidepanel.js` — порт, переподключение, делегирование кликов → команды, локальный UI-state.
- В `content.js` остаются: построчные бейджи (`badgeRow` и чипы), FAB, меню отзыва о брокере
  (контекстное к строке), CSV-экспорт (по команде).

## 4. Карточка груза

- Клик по `ⓘ details` / 👤 в строке → `runtime.sendMessage({type:"open-panel"})` +
  локально `detailLoadId = id; render()`. Hot loads в панели тоже кликабельны (`openDetail`). Снапшот несёт `detail`: поля груза, разбивка «Кому
  подходит» (`LLFLEET`), `counterOffer`, Gmail compose URL, `preferredContactMethod`, safe bookingUrl.
- В панели: Email → `chrome.tabs.create({url})`, Call → `tel:`, Copy → `navigator.clipboard.writeText`.
  Отзыв о брокере из детали → команда во вкладку (кэш репутаций живёт там).

## 5. Удаляется / упрощается

- `#ll-panel`, `buildPanel`, `panelCollapsed`, кнопки «–» и 🙈 на странице, `ll_hide_panel` (попап-тумблер).
- 🙈 «скрыть на этой вкладке» → шапка side panel (`setHintsOff`; хранение прежнее — `LLTAB`/sessionStorage).
- `LLVIS` → `badgesVisible({hintsOff, hideBadges})`, `fabVisible({hintsOff})`.
- Цепочки/Hot loads/деталь считаются только при подключённом порте. Скоринг, sync, Telegram-алерты —
  всегда, как сейчас.
- CLAUDE.md: обновить структуру (popup.* → sidepanel.*, background.js, view-model.js, panel/).

## 6. Упаковка и релиз

- `scripts/package-ext.js`: файлы из `side_panel.default_path` (+ ассеты из HTML) и
  `background.service_worker` вместо `action.default_popup`.
- Версия 0.9.0. Cloud mode не меняется (noVNC показывает окно целиком, включая side panel).

## 7. Тесты

- Юнит: `view-model.test.js` (снапшот: цепочки, deals, detail, activeDriver), `panel/render.test.js`
  (экранирование, live/forecast плечи, пустые состояния), обновлённый `visibility.test.js`.
- e2e: `scripts/popup-rules.e2e.py` → открывает `sidepanel.html` (вкладка Settings).
- Ручная живая проверка на DAT: две DAT-вкладки ↔ переключение; `scrollToRow` из live-плеча;
  деталь из бейджа при закрытой/открытой панели; авто-пилот в фоновой вкладке не ломается.

## Риск (проверить первым шагом)

Проброс user gesture из клика в content script через `runtime.sendMessage` в `sidePanel.open()`.
Если не работает: FAB/бейдж при закрытой панели показывает тултип «Click the LoadLens icon»,
а карточка (`detailLoadId` во вкладке) отрисуется, когда пользователь откроет панель сам.

**Итог (2026-09-25):** фолбэк (тост) реализован и проверен в headless-прогоне; сам проброс жеста
FAB/бейдж → `sidePanel.open` проверяется только в живом Chrome — ждёт живой проверки на DAT.
