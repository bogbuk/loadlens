# HOS-калькулятор на лендинге — дизайн

Дата: 2026-09-30 · Статус: на ревью

## Зачем

SEO-план лендинга (см. память `loadlens-landing`): после базы и карточки CWS — страницы-инструменты.
Бесплатный HOS-калькулятор ловит поисковый спрос («hos calculator», «how many hours can I drive»,
«trucker hours calculator») и ведёт к установке: «LoadLens делает эту проверку на каждом грузе в DAT One».
HOS-легальность — одна из двух вещей, которых нет ни у одного конкурента, поэтому инструмент продаёт
именно дифференциатор.

**Успех:** страница `/hos-calculator/` (+ `/ru/`, `/ro/`) в sitemap с canonical/hreflang, считает
в браузере без бэкенда, кнопка установки шлёт цель `install_click` с `place=hos_calc`.

**Не цель:** точный ELD-аудит, split sleeper, adverse conditions, short-haul 16h/150 mi, учёт «скатывания»
часов цикла по дням внутри многодневного рейса. Об этом — дисклеймер на странице.

## Решение (вариант A из брейншторма)

Отдельная статическая страница на каждый язык, генерируемая той же сборкой `build-landing.js`, что и
главная. Отклонены: секция на главной (нет своего URL/title — не ранжируется) и перевод скриптом
(поисковик видит только EN — ошибка, исправленная 30.09).

## Компоненты

### 1. `shared/hos-trip.js` — `LLHOSTRIP` (чистый модуль)

Zero-dep, та же UMD-обёртка, что `shared/planner.js` (глобал + `module.exports`). Все величины — минуты.
`planner.stepHos` НЕ трогаем и не переиспользуем: в нём нет 30-минутного перерыва и 34h restart,
а правка рискует скорингом расширения.

**Константы:** `DRIVE=660`, `WINDOW=840`, `BREAK_AFTER=480`, `BREAK=30`, `RESET=600`, `RESTART=2040`,
`CYCLES = { "70-8": 4200, "60-7": 3600 }`.

**Вход `state`:**
| поле | смысл |
|---|---|
| `cycle` | `"70-8"` \| `"60-7"` |
| `drivenMin` | driving в текущей смене |
| `shiftMin` | сколько прошло с начала 14-часового окна |
| `sinceBreakMin` | driving после последнего перерыва ≥30 мин |
| `cycleUsedMin` | on-duty за последние 8/7 дней |

`normalize(state)` зажимает всё в `[0, лимит]`, неизвестный `cycle` → `"70-8"`, нечисла → 0.

**`remaining(state)`** → `{ drive, window, break, cycle, driveNow, limitedBy }`:
`drive = DRIVE − drivenMin`, `window = WINDOW − shiftMin`, `break = BREAK_AFTER − sinceBreakMin`,
`cycle = лимит − cycleUsedMin` (все ≥0); `driveNow = min(всех четырёх)` — сколько можно ехать прямо сейчас;
`limitedBy` — ключ минимума (при равенстве порядок `cycle, window, drive, break`: сначала то, что
лечится дольше).

**`plan(state, trip)`**, `trip = { miles, mph = 55, loadMin = 60, unloadMin = 60 }`
(`miles` 1–5000, `mph` 30–75, `loadMin`/`unloadMin` 0–600; вне диапазона — зажать).
Пошаговая симуляция:
1. `duty` погрузка (`loadMin`): on-duty не-driving — расходует окно и цикл; разрешена даже при
   исчерпанных лимитах (правила запрещают только driving). Если `loadMin ≥ 30` — обнуляет
   `sinceBreak` (с 2020 перерыв может быть on-duty не-driving).
2. Цикл driving, пока остались мили: `chunk = min(осталось, driveNow)`. Если `chunk = 0`, вставить
   паузу по приоритету: цикл исчерпан → `restart` 34h (сбрасывает всё, включая цикл); иначе 11h или
   14h исчерпаны → `reset` 10h (сбрасывает drive/window/sinceBreak); иначе → `break` 30 мин
   (off-duty: тикает окно, цикл нет; обнуляет sinceBreak). Driving расходует drive, window, sinceBreak, cycle.
3. `duty` разгрузка (`unloadMin`), как в п.1.
Соседние сегменты одного типа склеиваются.

Результат: `{ segments: [{ type: "duty"|"drive"|"break"|"reset"|"restart", min, miles? }],
totalMin, driveMin, restMin, resets, restarts }`. Защита от бесконечного цикла: не больше 200 сегментов
(с `mph ≥ 30` и `miles ≤ 5000` недостижимо, но гарантирует выход).

### 2. Страница `backend/public/hos-calculator/index.html` (EN, правится руками)

Та же дизайн-система, что главная (CSS-токены, светлая/тёмная тема, шапка с переключателем языков,
футер, баннер согласия). Блоки:
- **H1 + лид** («Free HOS calculator: how many hours can you still drive?»).
- **Форма**: цикл (radio 70/8 · 60/7), четыре поля часов в формате `ч`+`мин` (два number-инпута на поле),
  блок «Load (optional)»: мили, mph, погрузка/разгрузка. Пересчёт на `input`, без кнопки.
- **Остаток**: четыре полосы (11h / 14h / break / cycle) с текстом `6h 40m left`; лимит `limitedBy`
  подсвечен, над ними строка «You can drive **Xh Ym** now — then <что наступит>».
- **План рейса** (если введены мили): список сегментов с иконкой/цветом по типу, итог
  «Legal trip time: **Xh Ym** (drive A, rest B)» и прибытие по локальным часам браузера. Если есть
  `restart` — янтарная заметка про 34h restart.
- **CTA**: «LoadLens runs this check on every load in DAT One» + кнопка `data-cws="hos_calc"`,
  ссылка на CWS с `utm_source=hos_calc`.
- **SEO-текст**: короткие объяснения правил 11h / 14h / 30 min / 70h-8d / 34h restart и 3–4 вопроса
  FAQ; дисклеймер «planning estimate, not a replacement for your ELD; split sleeper and adverse
  conditions not modelled».
- Скрипты: `/js/hos-trip.js` (копия из shared) + `/js/hos-page.js` (DOM: чтение формы → `LLHOSTRIP` → рендер).
  Вёрстка — без внешних зависимостей, мобильная ширина с полями 16px.

### 3. Общий скрипт сайта `backend/public/js/site.js`

Сейчас инлайн в `index.html`: редирект по языку, баннер согласия, загрузка Метрики, цель `install_click`.
Выносим в `site.js` и подключаем на обеих страницах (главная ведёт себя как раньше). Редирект по
языку — на путь текущей страницы (`/hos-calculator/` → `/ru/hos-calculator/`), а не всегда на `/ru/`.
Предзагрузочный редирект остаётся маленьким инлайн-скриптом в `<head>` (иначе мигание EN), но
параметризован путём страницы.

### 4. Сборка и i18n

`scripts/build-landing.js` обобщается с одной страницы на список:
```
PAGES = [
  { src: "index.html",                dict: "landing/i18n.json",               path: "/",                 ld: "SoftwareApplication" },
  { src: "hos-calculator/index.html", dict: "landing/hos-calculator.i18n.json", path: "/hos-calculator/", ld: "WebApplication+FAQPage" },
]
```
URL языка = `/<lang>` + `path` (EN без префикса). SEO-блок, `data-i18n`-перевод, sitemap с hreflang —
для каждой страницы. Строки, которые рисует JS (`js.*`: «left», «Break 30 min», «10-hour reset»,
формат `{h}h {m}m`, …), живут в том же словаре; сборка кладёт их JSON-блоком
`<script type="application/json" id="ll-strings">` между маркерами `<!--STRINGS-START/END-->`
во все три версии (EN — из секции `en`). FAQ в JSON-LD `FAQPage` собирается из ключей `faq.*`.

### 5. Связки

- Главная: ссылка на калькулятор в карточке HOS (`f2`) и в футере — «Free HOS calculator».
- `privacy.html` §8 и строка в §про Yandex: «home page» → «home page and free tools pages»
  (Метрика грузится и на калькуляторе — после согласия).
- `robots.txt` без изменений (sitemap общий).

## Тесты

- `shared/hos-trip.test.js` (node:test, входит в `test:shared`):
  - свежий водитель, 500 mi @ 55 → driving 9h05m с перерывом 30 мин после 8h, без reset;
  - 700 mi свежий → 10h reset после 11h driving;
  - окно 14h кончается раньше 11h (shiftMin большой) → reset по окну;
  - цикл почти исчерпан → `restart` 34h, `restarts = 1`;
  - погрузка ≥30 мин засчитывается как перерыв, <30 — нет;
  - `remaining`: `limitedBy` и порядок при равенстве; `normalize` зажимает мусор и отрицательные;
  - склейка соседних сегментов, потолок сегментов.
- `scripts/landing-i18n.test.js` обобщается на все страницы: каждый `data-i18n` и `js.*`/`faq.*`
  переведён в ru/ro, нет лишних ключей, сгенерированные файлы не устарели, sitemap содержит 6 URL лендинга
  с hreflang, кнопка калькулятора ведёт на CWS с `utm_source=hos_calc`.
- `sync:shared` копирует `hos-trip.js` в `backend/public/js/` (с баннером AUTO-GENERATED).
- Ручная проверка в браузере (локальный бэкенд или прямое открытие файла): EN/RU/RO, тёмная тема,
  ширина 375px, баннер согласия, редирект по языку на обеих страницах.

## Риски

- **Юридическая точность.** Калькулятор — оценка; дисклеймер обязателен, формулировки без «compliant/legal
  guarantee». Упрощения перечислены на странице.
- **Вынос инлайн-скриптов** может сломать согласие/Метрику на главной — проверить вручную после деплоя
  (баннер, `ym` после Accept, `install_click`).
- **Фолбэк ServeStatic** отдаёт EN-главную на любой неизвестный URL — опечатка в пути даст 200 с чужой
  страницей; тест sitemap проверяет, что файлы по всем 6 путям существуют.
