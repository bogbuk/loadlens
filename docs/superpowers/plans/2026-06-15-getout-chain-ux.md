# Get-out цепочки — UX раскрытия плеч: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Превратить тупиковую карточку Get-out цепочки в раскрываемый аккордеон, где плечи честно размечены на «живое» (груз сейчас в выдаче DAT, клик → прокрутка к строке) и «прогноз по рынку» (крауд-плечи с меткой свежести), со сводкой `~N дней · $/день`.

**Architecture:** Чистая логика времени цепочки (горизонт `~N дней`, `$/день`) живёт в уже тестируемом `shared/planner.js` (новое поле `totalDriveMin` + функция `horizon()`), синкается в vendor. Презентация — в `extension/content.js`: аккордеон с состоянием раскрытия, рендер плеч с разметкой live/forecast, чипы из уже распарсенных полей `Load`. Прокрутка к строке DAT — новый метод `scrollToRow(resultId)` в `dat.adapter.js`. Backend не меняется.

**Tech Stack:** Vanilla JS (MV3 content script, zero-dep CommonJS shared-модули), `node:test` для shared, CSS в `extension/styles.css`.

---

## Файловая структура

| Файл | Ответственность | Изменение |
|---|---|---|
| `shared/planner.js` | каноничная логика цепочек | `finalize` отдаёт `totalDriveMin`; новая чистая `horizon(chain)→{days,perDay}` + экспорт |
| `shared/planner.test.js` | тесты планировщика | тесты на `totalDriveMin` и `horizon` |
| `extension/adapters/dat.adapter.js` | DOM-якоря DAT | новый `scrollToRow(resultId)` — прокрутка + flash-класс |
| `extension/styles.css` | стили панели + страницы | классы аккордеона/плеч/чипов; keyframes `ll-row-flash` |
| `extension/content.js` | панель и рендер | заменить `chainRow` на аккордеон-рендер + leg-detail + wiring клика |
| `extension/vendor/planner.js` | автокопия | через `npm run sync:shared` |

**Конвенция:** после правки `shared/*.js` — обязательно `npm run sync:shared` (иначе расширение и backend разойдутся). `vendor/` руками не редактировать.

---

## Task 1: planner.js — `totalDriveMin` + `horizon()`

**Files:**
- Modify: `shared/planner.js` (функция `finalize` ~175-193; добавить `horizon`; дополнить `return {...}` ~215)
- Test: `shared/planner.test.js`

- [ ] **Step 1: Написать падающие тесты**

Добавить в конец `shared/planner.test.js`:

```javascript
test("finalize отдаёт totalDriveMin = сумма driveMin по плечам", () => {
  const loads = [
    load({ id: "A", from: "CHI", to: "DAL", rate: 2000, mi: 920 }),
    load({ id: "B", from: "DAL", to: "LA", rate: 1900, mi: 1400 }),
  ];
  const chains = LLPLAN.plan({
    start: { market: "CHI" }, hosState: FRESH_HOS, loads,
    distance: zeroDistance, marketStrength: strengthFn, maxLegs: 3,
  });
  const two = chains.find((c) => c.legs.length === 2);
  assert.ok(two, "должна быть двухплечевая цепочка");
  const sum = two.legs.reduce((s, l) => s + l.driveMin, 0);
  assert.strictEqual(two.totalDriveMin, sum);
  assert.ok(two.totalDriveMin > 0);
});

test("horizon: days >= 0.5 и perDay = round(totalNet/days)", () => {
  const chain = {
    legs: [{ driveMin: 660 }, { driveMin: 660 }], // 2 плеча
    totalDriveMin: 1320, totalIdleMin: 600, totalNet: 3000,
  };
  const h = LLPLAN.horizon(chain);
  // elapsed = 1320 drive + 600 idle + 2*120 loadUnload = 2160 мин = 1.5 дня
  assert.strictEqual(h.days, 1.5);
  assert.strictEqual(h.perDay, Math.round(3000 / 1.5)); // 2000
});

test("horizon: пустая/нулевая цепочка не делит на ноль", () => {
  const h = LLPLAN.horizon({ legs: [], totalDriveMin: 0, totalIdleMin: 0, totalNet: 0 });
  assert.strictEqual(h.days, 0.5);
  assert.strictEqual(h.perDay, 0);
});
```

- [ ] **Step 2: Запустить тесты — убедиться, что падают**

Run: `node --test shared/planner.test.js`
Expected: FAIL — `two.totalDriveMin` is `undefined`; `LLPLAN.horizon is not a function`.

- [ ] **Step 3: Добавить `totalDriveMin` в `finalize`**

В `shared/planner.js`, в объекте, возвращаемом `finalize` (после `legs: c.legs.map(...)`), добавить поле рядом с `totalMiles`:

```javascript
      totalMiles: Math.round(c.totalMiles),
      totalDriveMin: c.legs.reduce((s, l) => s + l.driveMin, 0),
      totalNet: Math.round(c.totalRev - c.totalCost),
```

- [ ] **Step 4: Добавить чистую `horizon()` рядом с `score`/`finalize`**

В `shared/planner.js` (перед блоком `// ---- утилиты ----`) добавить:

```javascript
  // Грубая оценка горизонта цепочки в днях и дохода в день — для сводки в UI.
  // elapsed = чистое вождение + вынужденный HOS-сон (idle) + погрузка/разгрузка (2ч × плечи).
  // Делим на сутки; пол-дня — минимальная гранулярность. Чистая функция (для теста/UI).
  function horizon(chain) {
    const legs = (chain.legs && chain.legs.length) || 0;
    const elapsedMin = (chain.totalDriveMin || 0) + (chain.totalIdleMin || 0) + legs * LOAD_UNLOAD_MIN;
    const days = Math.max(0.5, Math.round((elapsedMin / (60 * 24)) * 2) / 2);
    const perDay = Math.round((chain.totalNet || 0) / days);
    return { days, perDay };
  }
```

- [ ] **Step 5: Экспортировать `horizon`**

В `return { plan, stepHos, legMinutes, legEconomics, DEFAULTS, HOS };` добавить `horizon`:

```javascript
  return { plan, stepHos, legMinutes, legEconomics, horizon, DEFAULTS, HOS };
```

- [ ] **Step 6: Запустить тесты — убедиться, что проходят**

Run: `node --test shared/planner.test.js`
Expected: PASS (все тесты, включая 3 новых).

- [ ] **Step 7: Синхронизировать vendor**

Run: `npm run sync:shared`
Expected: `extension/vendor/planner.js` обновлён (содержит `horizon` и `totalDriveMin`).

- [ ] **Step 8: Commit**

```bash
git add shared/planner.js shared/planner.test.js extension/vendor/planner.js backend/shared
git commit -m "feat(planner): totalDriveMin + horizon() для сводки цепочки"
```

---

## Task 2: dat.adapter.js — `scrollToRow(resultId)`

**Files:**
- Modify: `extension/adapters/dat.adapter.js` (объект `DAT_ADAPTER`, рядом с `anchor`)

DOM-зависимый метод (юнит-тест не пишем — нет jsdom в `node --test`; проверяется вручную в Chrome на шаге Task 5). Метод толерантен к отсутствию строки.

- [ ] **Step 1: Добавить метод `scrollToRow` в `DAT_ADAPTER`**

В `extension/adapters/dat.adapter.js`, внутри объекта `DAT_ADAPTER` после метода `anchor(loads){...}` (перед `collect()`), добавить:

```javascript
    // Прокрутка выдачи DAT к строке груза по resultId + кратковременная подсветка.
    // resultId совпадает с id="table-row-<resultId>" (как в anchor). Возвращает true, если строка найдена.
    scrollToRow(resultId) {
      if (resultId == null) return false;
      const row = document.getElementById(ROW_ID_PREFIX + resultId);
      if (!row) return false;
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.add("ll-row-flash");
      setTimeout(() => row.classList.remove("ll-row-flash"), 2000);
      return true;
    },
```

- [ ] **Step 2: Проверить, что файл парсится**

Run: `node -e "require('./extension/adapters/dat.adapter.js'); console.log('ok')"`
Expected: печатает `ok` (без `document` метод не вызывается при загрузке — `register` использует только `resultIdOf`/`anchor`; глобальный `document` не трогается на этапе require).

Если упадёт на отсутствии `document`/`LLADAPT` — значит файл и так требует браузерного окружения; тогда вместо запуска просто визуально убедиться, что метод добавлен синтаксически корректно, и продолжить (проверка — в Chrome на Task 5).

- [ ] **Step 3: Commit**

```bash
git add extension/adapters/dat.adapter.js
git commit -m "feat(dat-adapter): scrollToRow(resultId) — прокрутка+подсветка строки выдачи"
```

---

## Task 3: styles.css — стили аккордеона, плеч, чипов, flash

**Files:**
- Modify: `extension/styles.css` (после блока `.chain .meta`, строка ~119)

Светлая палитра панели (фон `#f8fafc`, текст `#0f1720`, вторичный `#64748b`, акценты `#16a34a/#d97706/#dc2626/#1d4ed8`). Flash-класс применяется к строке на странице DAT (CSS грузится page-wide через `content_scripts.css`).

- [ ] **Step 1: Добавить стили**

В `extension/styles.css` сразу после строки `#ll-panel .chain .meta { ... }` (~119) вставить:

```css
/* аккордеон цепочки */
#ll-panel .chain .chain-hd { cursor: pointer; }
#ll-panel .chain .chain-hd .route .caret { color: #94a3b8; font-weight: 700; }
#ll-panel .chain.open { background: #eef4ff; }
#ll-panel .chain-legs { margin-top: 6px; border-top: 1px dashed #e2e8f0; }
#ll-panel .leg { padding: 7px 2px 7px 8px; border-bottom: 1px dashed #eef1f4; }
#ll-panel .leg:last-child { border-bottom: 0; }
#ll-panel .leg.leg-live { cursor: pointer; }
#ll-panel .leg.leg-live:hover { background: #f1f5f9; border-radius: 6px; }
#ll-panel .leg.leg-fc { opacity: .72; }
#ll-panel .leg .leg-top { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
#ll-panel .leg .leg-tag { font-size: 9.5px; font-weight: 800; padding: 1px 6px; border-radius: 9px; white-space: nowrap; }
#ll-panel .leg .leg-tag.live { background: #dcfce7; color: #166534; }
#ll-panel .leg .leg-tag.fc { background: #eef1f4; color: #64748b; }
#ll-panel .leg .leg-idx { font-size: 10px; color: #94a3b8; white-space: nowrap; }
#ll-panel .leg .leg-route { font-weight: 700; font-size: 12px; margin-top: 3px; }
#ll-panel .leg .leg-eco { font-size: 11.5px; color: #475569; margin-top: 2px; }
#ll-panel .leg .leg-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
#ll-panel .leg .lchip { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: #eef1f4; color: #475569; white-space: nowrap; }
#ll-panel .leg .lchip.good { background: #dcfce7; color: #166534; }
#ll-panel .leg .lchip.ok   { background: #fef9c3; color: #854d0e; }
#ll-panel .leg .lchip.risk { background: #fee2e2; color: #991b1b; }
#ll-panel .leg .lchip.book { background: #dbeafe; color: #1e40af; }

/* подсветка строки в выдаче DAT при клике по живому плечу */
@keyframes ll-row-flash { 0%,100% { background: transparent; } 30% { background: rgba(29,78,216,.22); } }
.ll-row-flash { animation: ll-row-flash 1s ease-in-out 2; outline: 2px solid #1d4ed8 !important; outline-offset: -2px; }
```

- [ ] **Step 2: Commit**

```bash
git add extension/styles.css
git commit -m "style(panel): аккордеон цепочки, плечи, чипы, flash строки DAT"
```

---

## Task 4: content.js — аккордеон-рендер цепочек + leg-detail + клик

**Files:**
- Modify: `extension/content.js`
  - `chainRow` (~496-502) → удалить, заменить набором функций рендера
  - блок рендера chains в `render()` (~440, ~457) → новый вызов
  - привязка обработчиков после `bd.innerHTML = ...` (~465-476) → добавить wiring

Состояние раскрытия держим в module-scope переменной, чтобы периодический `render()` (каждые 400мс) не схлопывал открытую цепочку.

- [ ] **Step 1: Добавить module-state и хелперы рендера**

В `extension/content.js`, рядом с другими module-переменными вверху IIFE (там же, где `let timer = null;` / кэши), добавить:

```javascript
  let expandedChainSig = null;   // сигнатура раскрытой цепочки (route path), переживает re-render
```

Затем заменить функцию `chainRow(c)` (целиком, ~496-502) на следующий блок функций:

```javascript
  // сигнатура цепочки = путь рынков (стабильна между рендерами)
  function chainSig(c) { return c.legs.map((l) => l.origin).concat(c.finalMarket).join(">"); }

  // контекст рендера: индекс пула по loadId + множество «живых» loadId (видимых в выдаче)
  function chainCtx(visible, pool) {
    const poolById = new Map(pool.map((l) => [l.loadId, l]));
    const liveIds = new Set(visible.map((l) => l.loadId));
    return { poolById, liveIds };
  }

  const HOS_ICON = { green: "✓", amber: "!", red: "✕" };

  // свёрнутая/раскрытая карточка цепочки
  function chainCard(c, ctx) {
    const sig = chainSig(c);
    const open = sig === expandedChainSig;
    const path = c.legs.map((l) => l.origin).concat(c.finalMarket).join(" → ");
    const h = LLPLAN.horizon(c);
    const caret = open ? "▾" : "▸";
    const meta = `$${c.chainNetRpm.toFixed(2)}/mi · net $${c.totalNet} · ~${h.days}д · $${h.perDay}/д · HOS ${HOS_ICON[c.hosBadge] || "?"}`;
    let html = `<div class="chain ll-${c.hosBadge}${open ? " open" : ""}">` +
      `<div class="chain-hd" data-sig="${esc(sig)}">` +
      `<div class="route">${esc(path)} <span class="caret">${caret}</span></div>` +
      `<div class="meta">${esc(meta)}</div></div>`;
    if (open) html += `<div class="chain-legs">` + c.legs.map((l, i) => legRow(l, i, c, ctx)).join("") + `</div>`;
    return html + `</div>`;
  }

  // одно плечо: live (из выдачи) или forecast (крауд)
  function legRow(leg, i, c, ctx) {
    const full = ctx.poolById.get(leg.loadId) || {};
    const isLive = ctx.liveIds.has(leg.loadId);
    const rpm = (leg.loadedMiles + leg.deadhead) > 0 ? leg.rate / (leg.loadedMiles + leg.deadhead) : 0;
    const route = `${esc(leg.origin)} → ${esc(leg.dest)}`;
    const idx = `плечо ${i + 1} · ${esc(leg.equipment || "")}`;
    if (isLive) {
      const rid = full.resultId != null ? ` data-result="${esc(String(full.resultId))}"` : "";
      const eco = `$${money(leg.rate)} · ${leg.loadedMiles}mi${leg.deadhead ? " +" + leg.deadhead + "dh" : ""} · $${rpm.toFixed(2)}/mi · HOS ${HOS_ICON[leg.hosBadge] || "?"}`;
      return `<div class="leg leg-live"${rid}>` +
        `<div class="leg-top"><span class="leg-tag live">● СЕЙЧАС В ВЫДАЧЕ ↗</span><span class="leg-idx">${idx}</span></div>` +
        `<div class="leg-route">${route}</div>` +
        `<div class="leg-eco">${esc(eco)}</div>` +
        `<div class="leg-chips">${liveChips(full)}</div></div>`;
    }
    // forecast (крауд) плечо. laneKeyOf ждёт originMarket/destMarket — у leg поля origin/dest, маппим.
    const laneKey = laneKeyOf({ originMarket: leg.origin, destMarket: leg.dest, equipment: leg.equipment });
    const median = laneCache.has(laneKey) ? laneCache.get(laneKey) : null;
    const rpmTxt = median != null ? `$${median.toFixed(2)}/mi медиана lane` : `$${rpm.toFixed(2)}/mi`;
    const fresh = freshnessText(full.lastSeen);
    const density = (crowdCache.get(leg.origin) || []).length;
    const densTxt = density ? ` · ~${density} груз. из рынка` : "";
    const isLast = i === c.legs.length - 1;
    const strengthTxt = isLast ? ` · финиш ${strengthBar(strengthOf(leg.dest))}` : "";
    return `<div class="leg leg-fc">` +
      `<div class="leg-top"><span class="leg-tag fc">◔ ПРОГНОЗ ПО РЫНКУ</span><span class="leg-idx">${esc(fresh)}</span></div>` +
      `<div class="leg-route">${route}</div>` +
      `<div class="leg-eco">${esc(rpmTxt)}${esc(densTxt)}${esc(strengthTxt)} · HOS ${HOS_ICON[leg.hosBadge] || "?"}</div></div>`;
  }

  // чипы живого плеча из распарсенного Load
  function liveChips(load) {
    const out = [];
    // репутация брокера: crowd (если есть отзывы) иначе CS-бейдж
    const rep = load.brokerMc ? repCache.get(String(load.brokerMc)) : null;
    if (rep && rep.n) {
      out.push(`<span class="lchip ${CROWD_CLS[rep.level] === "ll-good" ? "good" : rep.level === "bad" ? "risk" : rep.level === "mixed" ? "ok" : ""}">${esc((load.brokerName ? load.brokerName + " · " : "") + crowdShort(rep))}</span>`);
    } else if (typeof LLSCORE !== "undefined") {
      const b = LLSCORE.brokerBadge(load);
      if (b.level !== "unknown") {
        const cls = b.level === "good" ? "good" : b.level === "ok" ? "ok" : "risk";
        const tag = b.level === "good" ? "🛡 надёжный" : b.level === "ok" ? "ок" : "⚠ риск";
        out.push(`<span class="lchip ${cls}">${esc((load.brokerName ? load.brokerName + " · " : "") + tag + (b.creditScore != null ? " " + b.creditScore + "CS" : ""))}</span>`);
      }
    }
    const pick = fmtPickup(load.availability);
    if (pick) out.push(`<span class="lchip">pickup ${esc(pick)}</span>`);
    if (load.weight || load.lengthFt) {
      const wl = [load.weight ? Math.round(load.weight / 1000) + "klb" : null, load.lengthFt ? load.lengthFt + "ft" : null].filter(Boolean).join(" · ");
      out.push(`<span class="lchip">${esc(wl)}</span>`);
    }
    if (load.isNegotiable) out.push(`<span class="lchip">торг</span>`);
    if (load.isFactorable) out.push(`<span class="lchip">факторинг</span>`);
    if (load.bookNow) out.push(`<span class="lchip book">Book Now</span>`);
    return out.join("");
  }

  // короткий crowd-вердикт для чипа плеча
  function crowdShort(rep) {
    if (rep.level === "good") return "🛡 ок";
    if (rep.level === "bad") return "⚠ риск";
    if (rep.level === "thin") return rep.n + " отзыв.";
    return "смешанно";
  }

  function fmtPickup(av) {
    if (!av || !av.earliest) return null;
    const d = new Date(av.earliest);
    if (isNaN(d.getTime())) return null;
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return "сегодня";
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  }

  function freshnessText(lastSeen) {
    if (!lastSeen) return "прогноз";
    const d = new Date(lastSeen);
    if (isNaN(d.getTime())) return "прогноз";
    const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (days <= 0) return "видели сегодня";
    if (days === 1) return "видели вчера";
    return `видели ${days} дн назад`;
  }

  function strengthBar(s) {
    const n = Math.max(0, Math.min(5, Math.round((s || 0) * 5)));
    return "▰".repeat(n) + "▱".repeat(5 - n);
  }

  const money = (n) => Math.round(n || 0).toLocaleString("en-US");
```

> Примечание: `CROWD_CLS`, `repCache`, `laneCache`, `laneKeyOf`, `crowdCache`, `strengthOf`, `esc` уже определены в `content.js` выше по файлу — переиспользуем их.

- [ ] **Step 2: Подключить новый рендер в `render()`**

В `render()` блок построения chains-секции (строка ~457) сейчас такой:

```javascript
      (chains.length ? "<h4>Get-out цепочки</h4>" + chains.map(chainRow).join("") : "<div class='note'>Цепочки появятся, когда видно достаточно грузов из рынка старта.</div>") +
```

Заменить на (используя `ctx`, который создадим из `loads` и пула):

```javascript
      (chains.length ? "<h4>Get-out цепочки</h4>" + chains.map((c) => chainCard(c, chainsCtx)).join("") : "<div class='note'>Цепочки появятся, когда видно достаточно грузов из рынка старта.</div>") +
```

А выше, рядом со строкой где считаются `chains` (~440):

```javascript
    const chains = buildChains(chainPool(loads), start).filter((c) => c.legs.length >= 1);
```

добавить сразу под ней:

```javascript
    const chainsCtx = chainCtx(loads, chainPool(loads));
```

- [ ] **Step 3: Привязать обработчики кликов после `bd.innerHTML = ...`**

В `render()`, в блоке привязки обработчиков (после `const csvBtn = ...; if (csvBtn) ...`, ~476), добавить:

```javascript
    bd.querySelectorAll(".chain-hd").forEach((hd) => {
      hd.addEventListener("click", () => {
        const sig = hd.getAttribute("data-sig");
        expandedChainSig = (expandedChainSig === sig) ? null : sig;
        render();
      });
    });
    bd.querySelectorAll(".leg.leg-live").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const rid = el.getAttribute("data-result");
        if (rid != null && adapter && typeof adapter.scrollToRow === "function") adapter.scrollToRow(rid);
      });
    });
```

- [ ] **Step 4: Прогнать существующие тесты расширения**

Run: `npm test`
Expected: PASS — `sync:shared` + shared-тесты (включая Task 1) + extension-тесты. Рендер цепочек не покрыт юнит-тестами (DOM), но не должен ломать существующие (`csv`, `drivers`, `adapters`, `dat.graphql`).

- [ ] **Step 5: Commit**

```bash
git add extension/content.js
git commit -m "feat(content): аккордеон Get-out цепочки — плечи live/прогноз, чипы, клик к строке DAT"
```

---

## Task 5: Ручная проверка в Chrome + финальный прогон

**Files:** нет (верификация)

- [ ] **Step 1: Полный прогон тестов**

Run: `npm test`
Expected: все shared (17+3 новых) и extension (10) зелёные; `sync:shared` без diff после коммитов.

- [ ] **Step 2: Убедиться, что vendor синхронен**

Run: `npm run sync:shared && git status --porcelain extension/vendor backend/shared`
Expected: пустой вывод (нет несинхронизированных изменений).

- [ ] **Step 3: Загрузить расширение и проверить вручную**

1. `chrome://extensions` → Загрузить распакованное → `extension/` (или Reload).
2. Открыть залогиненную сессию DAT One, сделать поиск грузов (FindLoads).
3. В панели LoadLens в секции «Get-out цепочки»:
   - [ ] клик по цепочке раскрывает плечи; повторный клик сворачивает; открыта одна за раз;
   - [ ] раскрытие переживает авто-рендер (не схлопывается само через ~0.4с);
   - [ ] сводка показывает `~N д · $K/д`;
   - [ ] плечо 1 — зелёный ярлык «● СЕЙЧАС В ВЫДАЧЕ ↗», чипы (брокер/pickup/вес·длина/флаги);
   - [ ] клик по плечу 1 прокручивает выдачу DAT к строке и подсвечивает её (flash);
   - [ ] плечи 2–3 — приглушённый «◔ ПРОГНОЗ ПО РЫНКУ · видели N дн назад», медиана/плотность/сила финиша; некликабельны.

- [ ] **Step 4: Daily report (по правилу проекта)**

В конце сессии предложить сохранить отчёт в `docs/daily-reports/2026-06-15.md`.

---

## Self-Review (заполнено при написании плана)

- **Spec coverage:** аккордеон (Task 4 §1-3), плечо-live + scroll (Task 2, Task 4), плечи-прогноз + свежесть (Task 4, `lastSeen` подтверждён в `loads.service.ts`), сводка `~N дней/$ день` (Task 1 `horizon`), чипы (репутация/pickup/вес·длина/флаги — Task 4 `liveChips`, поля подтверждены в `dat.graphql.js`), backend без изменений ✔.
- **Placeholder scan:** код приведён полностью в каждом шаге; плейсхолдеров нет.
- **Type consistency:** `chainSig`/`chainCtx`/`chainCard`/`legRow`/`liveChips`/`horizon`/`scrollToRow` согласованы между задачами; `HOS_ICON`/`CROWD_CLS` переиспользуются; `horizon(c)` вызывается на finalize-выводе, который содержит `legs`/`totalDriveMin`/`totalIdleMin`/`totalNet` (Task 1).
