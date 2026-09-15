const test = require("node:test");
const assert = require("node:assert");
const LLPOLICY = require("./autopilot-policy.js");

// Локальное время машины — политика окна тишины работает в нём (см. autopilot-policy.js).
const at = (h, m = 0) => new Date(2026, 8, 15, h, m, 0, 0).getTime();
const QUIET = { from: 22, to: 5 };

// ---------- inQuiet ----------
test("inQuiet: окно через полночь ловит поздний вечер", () => {
  assert.strictEqual(LLPOLICY.inQuiet(at(23, 30), QUIET), true);
});
test("inQuiet: окно через полночь ловит ранее утро", () => {
  assert.strictEqual(LLPOLICY.inQuiet(at(4, 59), QUIET), true);
});
test("inQuiet: час окончания уже вне окна", () => {
  assert.strictEqual(LLPOLICY.inQuiet(at(5, 0), QUIET), false);
});
test("inQuiet: день вне окна", () => {
  assert.strictEqual(LLPOLICY.inQuiet(at(14, 0), QUIET), false);
});
test("inQuiet: обычное окно внутри суток", () => {
  const q = { from: 1, to: 5 };
  assert.strictEqual(LLPOLICY.inQuiet(at(2, 0), q), true);
  assert.strictEqual(LLPOLICY.inQuiet(at(23, 0), q), false);
});
test("inQuiet: нет настройки — окна нет", () => {
  assert.strictEqual(LLPOLICY.inQuiet(at(3, 0), null), false);
});
test("inQuiet: from === to трактуем как выключено, а не круглые сутки", () => {
  assert.strictEqual(LLPOLICY.inQuiet(at(3, 0), { from: 5, to: 5 }), false);
});
test("inQuiet: нечисловые границы игнорируются", () => {
  assert.strictEqual(LLPOLICY.inQuiet(at(3, 0), { from: null, to: 5 }), false);
});

// ---------- msUntilQuietEnd ----------
test("msUntilQuietEnd: вечер до 05:00 следующего дня", () => {
  const ms = LLPOLICY.msUntilQuietEnd(at(23, 0), QUIET);
  assert.strictEqual(ms, 6 * 3600000);
});
test("msUntilQuietEnd: ночь до 05:00 того же дня", () => {
  const ms = LLPOLICY.msUntilQuietEnd(at(4, 30), QUIET);
  assert.strictEqual(ms, 30 * 60000);
});
test("msUntilQuietEnd: вне окна — 0", () => {
  assert.strictEqual(LLPOLICY.msUntilQuietEnd(at(14, 0), QUIET), 0);
});

// ---------- nextTick ----------
const tick = (over) => LLPOLICY.nextTick({ now: at(14, 0), sseLive: false, quiet: null, intervalMs: 0, rnd: () => 0, ...over });

test("nextTick: без SSE база — нижний потолок 120с, даже если в настройках меньше", () => {
  const r = tick({ intervalMs: 30000 });
  assert.strictEqual(r.skip, false);
  assert.strictEqual(r.delayMs, LLPOLICY.MIN_INTERVAL_MS);
});
test("nextTick: настройка выше потолка побеждает", () => {
  const r = tick({ intervalMs: 300000 });
  assert.strictEqual(r.delayMs, 300000);
});
test("nextTick: живой SSE поднимает базу до SSE_INTERVAL_MS", () => {
  const r = tick({ sseLive: true, intervalMs: 180000 });
  assert.strictEqual(r.delayMs, LLPOLICY.SSE_INTERVAL_MS);
});
test("nextTick: живой SSE не опускает базу ниже пользовательской настройки", () => {
  const r = tick({ sseLive: true, intervalMs: 20 * 60000 });
  assert.strictEqual(r.delayMs, 20 * 60000);
});
test("nextTick: джиттер растягивает задержку до 2·base", () => {
  const r = tick({ intervalMs: 180000, rnd: () => 0.999 });
  assert.ok(r.delayMs > 180000 && r.delayMs < 360000, `delay=${r.delayMs}`);
});
test("nextTick: в окне тишины — skip и сон до конца окна", () => {
  const r = tick({ now: at(23, 0), quiet: QUIET });
  assert.strictEqual(r.skip, true);
  assert.strictEqual(r.delayMs, 6 * 3600000);
});
test("nextTick: пробуждение из окна тишины размазано джиттером", () => {
  const r = tick({ now: at(23, 0), quiet: QUIET, rnd: () => 0.999 });
  assert.ok(r.delayMs > 6 * 3600000, "сон должен быть длиннее ровного окна");
  assert.ok(r.delayMs <= 6 * 3600000 + LLPOLICY.WAKE_JITTER_MS, `delay=${r.delayMs}`);
});
test("nextTick: вне окна тишины настройка quiet не мешает обычному тику", () => {
  const r = tick({ now: at(14, 0), quiet: QUIET, intervalMs: 180000 });
  assert.strictEqual(r.skip, false);
  assert.strictEqual(r.delayMs, 180000);
});

// ---------- allowReload ----------
const reload = (over) => LLPOLICY.allowReload({ now: at(14, 0), lastReloadAt: 0, lastDataAt: 0, ...over });

test("allowReload: первый reload в сессии разрешён", () => {
  assert.strictEqual(reload(), true);
});
test("allowReload: пока не прошёл потолок 15 мин — запрещён", () => {
  assert.strictEqual(reload({ lastReloadAt: at(14, 0) - 10 * 60000 }), false);
});
test("allowReload: после потолка снова разрешён", () => {
  assert.strictEqual(reload({ lastReloadAt: at(14, 0) - 16 * 60000 }), true);
});
test("allowReload: свежая выдача — reload не нужен", () => {
  assert.strictEqual(reload({ lastDataAt: at(14, 0) - 60000 }), false);
});
test("allowReload: протухшая выдача — reload разрешён", () => {
  assert.strictEqual(reload({ lastDataAt: at(14, 0) - 20 * 60000 }), true);
});
test("allowReload: свой потолок можно задать явно", () => {
  assert.strictEqual(reload({ lastReloadAt: at(14, 0) - 5 * 60000, minGapMs: 60000 }), true);
});

// ---------- scrollBudget ----------
test("scrollBudget: первый доскролл выдачи — полный бюджет", () => {
  assert.strictEqual(LLPOLICY.scrollBudget({ first: true, sseLive: false, maxSteps: 10 }), 10);
});
test("scrollBudget: живой SSE — не скроллим вовсе", () => {
  assert.strictEqual(LLPOLICY.scrollBudget({ first: false, sseLive: true, maxSteps: 10 }), 0);
});
test("scrollBudget: первый доскролл важнее живого SSE", () => {
  assert.strictEqual(LLPOLICY.scrollBudget({ first: true, sseLive: true, maxSteps: 10 }), 10);
});
test("scrollBudget: обычный тик — две страницы", () => {
  assert.strictEqual(LLPOLICY.scrollBudget({ first: false, sseLive: false, maxSteps: 10 }), LLPOLICY.TICK_SCROLL_STEPS);
});
test("scrollBudget: бюджет тика не превышает общий лимит", () => {
  assert.strictEqual(LLPOLICY.scrollBudget({ first: false, sseLive: false, maxSteps: 1 }), 1);
});
test("scrollBudget: без maxSteps берём дефолт", () => {
  assert.strictEqual(LLPOLICY.scrollBudget({ first: true, sseLive: false }), LLPOLICY.DEFAULT_MAX_STEPS);
});

// ---------- normalizeQuiet ----------
test("normalizeQuiet: дефолт — ночное окно 22–5", () => {
  assert.deepStrictEqual(LLPOLICY.normalizeQuiet(undefined), { from: 22, to: 5 });
});
test("normalizeQuiet: явное выключение сохраняется", () => {
  assert.strictEqual(LLPOLICY.normalizeQuiet(null), null);
});
test("normalizeQuiet: часы приводятся к целым 0..23", () => {
  assert.deepStrictEqual(LLPOLICY.normalizeQuiet({ from: "21.7", to: 6 }), { from: 21, to: 6 });
});
test("normalizeQuiet: мусор → дефолт", () => {
  assert.deepStrictEqual(LLPOLICY.normalizeQuiet({ from: 99, to: -3 }), { from: 22, to: 5 });
});
