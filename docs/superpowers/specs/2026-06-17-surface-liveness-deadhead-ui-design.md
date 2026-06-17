# Дизайн: показ liveness / originDeadheadMi в панели

**Дата:** 2026-06-17
**Проект:** LoadLens
**Статус:** утверждён к реализации

## Проблема

Бэкенд `GET /loads/near` уже отдаёт по каждому грузу два поля, которые панель пока не использует
(отмечено как пробел в финальном ревью фичи радиуса/свежести):

- `liveness` (0..1) — серверный скор свежести (recency-decay). Клиент сейчас приближает свежесть
  только по `lastSeen` через `freshnessText` (день-гранулярность), не используя более честный серверный скор.
- `originDeadheadMi` — крюк до соседнего рынка (появляется, когда onward-плечо взято из рынка-соседа
  в радиусе, а не из точного рынка назначения). Не показывается вообще.

Цель — донести оба сигнала диспетчеру: насколько свежи данные плеча и взято ли плечо из соседнего рынка.

## Решения (зафиксированы в брейншторме)

- **liveness** → цветная точка + слово + относительное время. Бакеты: `>0.66 🟢 свежо`,
  `0.33–0.66 🟡 стынет`, `<0.33 🔴 могло уйти`. Показываем только на **forecast-плечах**
  (live-плечи буквально в текущей выдаче = максимально свежие и часто без поля `liveness`).
- **originDeadheadMi** → тег `↪ +Nmi сосед` **только** при `> 0`. Показываем на **обоих** типах
  плеч (объясняет крюк радиуса независимо от типа). При точном совпадении рынка (0) — ничего.
- Время в метке свежести оставляем в текущей день-гранулярности (`freshnessText`); новое — точка+слово.

## Изменения

Только `extension/content.js` + один класс в `extension/styles.css`. Бэкенд и данные не меняются —
поля уже приходят в ответе `/loads/near` и лежат на объекте пула (`ctx.poolById.get(leg.loadId)`).

### 1. `livenessLabel(liveness)` — новый чистый inline-хелпер (content.js)

Рядом с `freshnessText`/`strengthBar`. Возвращает `{ dot, word }`:
- `liveness > 0.66` → `{ dot: "🟢", word: "свежо" }`
- `liveness >= 0.33` → `{ dot: "🟡", word: "стынет" }`
- иначе → `{ dot: "🔴", word: "могло уйти" }`

### 2. `legRow` — forecast-ветка: метка свежести

Сейчас `.leg-idx` содержит `freshnessText(full.lastSeen)`. Заменить на:
- если `full.liveness != null`: `${dot} ${word} · ${freshnessText(full.lastSeen)}`
- иначе (нет серверной аннотации): прежний `freshnessText(full.lastSeen)` (graceful fallback).

### 3. `neighborTag(full)` — новый чистый inline-хелпер + врезка

Возвращает строку:
- если `full && full.originDeadheadMi > 0`: `<span class="leg-nb">↪ +${full.originDeadheadMi}mi сосед</span>`
- иначе: `""`.

Аппендить к содержимому `.leg-route` в **обеих** ветках `legRow` (live и forecast):
`<div class="leg-route">${route}${neighborTag(full)}</div>`.

### 4. CSS — `extension/styles.css`

Один класс в стиле `.leg-idx`/`.lchip` (мелкий приглушённый пилл с отступом слева):
```css
#ll-panel .leg .leg-nb { margin-left: 6px; font-size: 10px; font-weight: 700;
  padding: 1px 6px; border-radius: 8px; background: #eef1f4; color: #64748b; white-space: nowrap; }
```

## Обработка ошибок / границы

- `liveness == null` (груз из старого пути / видимой выдачи без аннотации) → fallback на `freshnessText`.
- `originDeadheadMi` отсутствует или `0` → тег не рисуется (точный рынок).
- `full` пуст (`ctx.poolById` не нашёл loadId) → `neighborTag` возвращает `""`, метка свежести по fallback.

## Тестирование

- `livenessLabel`/`neighborTag` — чистые inline-хелперы (как `freshnessText`/`strengthBar`), у `content.js`
  нет юнит-харнесса. Проверка: `node --check extension/content.js` + ручной smoke в панели
  (forecast-плечо показывает цветную метку; плечо из соседа — тег `↪ +Nmi сосед`).

## Вне scope

- Liveness на live-плечах (они в текущей выдаче, поля часто нет).
- Минутная гранулярность времени (оставляем дневную из `freshnessText`).
- Любые правки бэкенда / формы ответа `/loads/near`.
