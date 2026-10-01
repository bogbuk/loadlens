const test = require("node:test");
const assert = require("node:assert");
const H = require("./hos-trip.js");

const FRESH = { cycle: "70-8", drivenMin: 0, shiftMin: 0, sinceBreakMin: 0, cycleUsedMin: 0 };
const NO_DOCK = { loadMin: 0, unloadMin: 0 };
const shape = (p) => p.segments.map((s) => `${s.type}:${s.min}`);

test("normalize: мусор, отрицательные и строки зажимаются; неизвестный цикл → 70-8", () => {
  assert.deepStrictEqual(
    H.normalize({ cycle: "x", drivenMin: -5, shiftMin: "abc", sinceBreakMin: 999, cycleUsedMin: 99999 }),
    { cycle: "70-8", drivenMin: 0, shiftMin: 0, sinceBreakMin: 0, cycleUsedMin: 4200 });
  assert.deepStrictEqual(
    H.normalize({ cycle: "60-7", drivenMin: "90", shiftMin: "", sinceBreakMin: "45", cycleUsedMin: 4000 }),
    { cycle: "60-7", drivenMin: 90, shiftMin: 0, sinceBreakMin: 45, cycleUsedMin: 3600 });
});

test("normalize: вождение после перерыва не больше вождения в смене", () => {
  assert.strictEqual(H.normalize({ drivenMin: 120, sinceBreakMin: 300 }).sinceBreakMin, 120);
});

test("remaining: свежий водитель упирается в 30-минутный перерыв через 8 часов", () => {
  assert.deepStrictEqual(H.remaining(FRESH),
    { drive: 660, window: 840, break: 480, cycle: 4200, driveNow: 480, limitedBy: "break" });
});

test("remaining: минимум — лимит 11h; при равенстве побеждает окно (порядок cycle, window, drive, break)", () => {
  assert.strictEqual(H.remaining({ drivenMin: 600, shiftMin: 600, sinceBreakMin: 0 }).limitedBy, "drive");
  const tie = H.remaining({ drivenMin: 600, shiftMin: 780, sinceBreakMin: 0 });
  assert.strictEqual(tie.limitedBy, "window");
  assert.strictEqual(tie.driveNow, 60);
});

test("remaining: цикл 60/7 исчерпан → ехать нельзя", () => {
  const r = H.remaining({ cycle: "60-7", cycleUsedMin: 3600 });
  assert.strictEqual(r.driveNow, 0);
  assert.strictEqual(r.limitedBy, "cycle");
});

test("plan: 500 mi @ 55 свежим — перерыв после 8h, без отдыха 10h", () => {
  const p = H.plan(FRESH, { miles: 500, mph: 55, ...NO_DOCK });
  assert.deepStrictEqual(shape(p), ["drive:480", "break:30", "drive:65"]);
  assert.deepStrictEqual(p.segments.map((s) => s.miles), [440, undefined, 60]);
  assert.strictEqual(p.totalMin, 575);
  assert.strictEqual(p.driveMin, 545);
  assert.strictEqual(p.restMin, 30);
  assert.strictEqual(p.resets, 0);
});

test("plan: 700 mi @ 50 — 10h reset после 11h вождения", () => {
  const p = H.plan(FRESH, { miles: 700, mph: 50, ...NO_DOCK });
  assert.deepStrictEqual(shape(p), ["drive:480", "break:30", "drive:180", "reset:600", "drive:180"]);
  assert.strictEqual(p.resets, 1);
  assert.strictEqual(p.totalMin, 1470);
});

test("plan: окно 14h кончается раньше 11h → reset по окну", () => {
  const p = H.plan({ drivenMin: 120, shiftMin: 780 }, { miles: 100, mph: 50, ...NO_DOCK });
  assert.deepStrictEqual(shape(p), ["drive:60", "reset:600", "drive:60"]);
});

test("plan: цикл кончается в пути → 34h restart", () => {
  const p = H.plan({ ...FRESH, cycleUsedMin: 4140 }, { miles: 100, mph: 50, ...NO_DOCK });
  assert.deepStrictEqual(shape(p), ["drive:60", "restart:2040", "drive:60"]);
  assert.strictEqual(p.restarts, 1);
});

test("plan: цикл исчерпан ещё до рейса → начинается с restart и завершается", () => {
  const p = H.plan({ ...FRESH, cycleUsedMin: 4200 }, { miles: 100, mph: 50, ...NO_DOCK });
  assert.deepStrictEqual(shape(p), ["restart:2040", "drive:120"]);
});

test("plan: перерыв нужен, а в окне ≤30 мин → сразу 10h reset", () => {
  const p = H.plan({ drivenMin: 480, sinceBreakMin: 480, shiftMin: 820 }, { miles: 50, mph: 50, ...NO_DOCK });
  assert.deepStrictEqual(shape(p), ["reset:600", "drive:60"]);
});

test("plan: погрузка ≥30 мин засчитывается как перерыв, <30 — нет", () => {
  const st = { drivenMin: 400, sinceBreakMin: 400, shiftMin: 420 };
  assert.deepStrictEqual(shape(H.plan(st, { miles: 100, mph: 50, loadMin: 30, unloadMin: 0 })),
    ["duty:30", "drive:120"]);
  assert.deepStrictEqual(shape(H.plan(st, { miles: 100, mph: 50, loadMin: 20, unloadMin: 0 })),
    ["duty:20", "drive:80", "break:30", "drive:40"]);
});

test("plan: соседние сегменты одного типа склеиваются; дефолты погрузки 60/60", () => {
  assert.deepStrictEqual(shape(H.plan(FRESH, { miles: 0, loadMin: 20, unloadMin: 20 })), ["duty:40"]);
  assert.deepStrictEqual(shape(H.plan(FRESH, { miles: 55, mph: 55 })), ["duty:60", "drive:60", "duty:60"]);
});

test("plan: скорость зажимается в 30–75, пустая → 55", () => {
  assert.strictEqual(H.plan(FRESH, { miles: 75, mph: 500, ...NO_DOCK }).driveMin, 60);
  assert.strictEqual(H.plan(FRESH, { miles: 55, mph: "", ...NO_DOCK }).driveMin, 60);
});

test("plan: 5000 mi @ 30 — длинный рейс с рестартами завершается, сегментов < 200", () => {
  const p = H.plan(FRESH, { miles: 5000, mph: 30, ...NO_DOCK });
  assert.strictEqual(p.driveMin, 10000);
  assert.ok(p.restarts >= 2);
  assert.ok(p.segments.length < 200);
});

test("normalize: незаполненное «вождение после перерыва» = всё вождение смены (перерыва не было)", () => {
  assert.strictEqual(H.normalize({ drivenMin: 420 }).sinceBreakMin, 420);
  assert.strictEqual(H.normalize({ drivenMin: 420, sinceBreakMin: "" }).sinceBreakMin, 420);
  assert.strictEqual(H.normalize({ drivenMin: 420, sinceBreakMin: 0 }).sinceBreakMin, 0);
  const p = H.plan({ drivenMin: 420, shiftMin: 540 }, { miles: 200, mph: 50, loadMin: 0, unloadMin: 0 });
  assert.deepStrictEqual(shape(p), ["drive:60", "break:30", "drive:180"]);
});

test("remaining: перерыв первым, но после него окно почти закрыто → лимит — окно (нужен 10h reset)", () => {
  const r = H.remaining({ drivenMin: 420, shiftMin: 770, sinceBreakMin: 420 });
  assert.strictEqual(r.limitedBy, "window");
  assert.strictEqual(r.driveNow, 60);
});

// Split sleeper (49 CFR 395.1(g)(1)(ii)): пара ≥7h sleeper + ≥2h, сумма ≥10h; ни один период не идёт в окно 14h,
// после второго периода 11h/14h считаются от конца первого.
const PAIR_STATE = { cycle: "70-8", drivenMin: 300, shiftMin: 700, sinceBreakMin: null, cycleUsedMin: 1000 };

test("splitPair 8/2: окно без первого отдыха, второй отдых ≥2h где угодно, после — от конца первого", () => {
  const r = H.splitPair(PAIR_STATE, { firstMin: 480, firstSleeper: true, drivenAfterMin: 120, sinceMin: 150 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.secondMin, 120);
  assert.strictEqual(r.secondSleeper, false);
  // окно: 700 − 480 = 220 прошло; перерыв: первый отдых ≥30 мин обнулил счётчик → 120 вождения после него
  assert.deepStrictEqual(r.now, { drive: 360, window: 620, break: 360, cycle: 3200, driveNow: 360, limitedBy: "drive" });
  assert.deepStrictEqual(r.after, { drive: 540, window: 690, break: 480, cycle: 3200, driveNow: 480, limitedBy: "break" });
  assert.deepStrictEqual(r.state, { cycle: "70-8", drivenMin: 300, shiftMin: 220, sinceBreakMin: 120, cycleUsedMin: 1000 });
});

test("splitPair 7/3 и 3/7: длинный период обязан быть в sleeper berth", () => {
  const seven = H.splitPair(PAIR_STATE, { firstMin: 420, firstSleeper: true, drivenAfterMin: 0, sinceMin: 0 });
  assert.strictEqual(seven.secondMin, 180);
  assert.strictEqual(seven.secondSleeper, false);
  const three = H.splitPair(PAIR_STATE, { firstMin: 180, firstSleeper: false, drivenAfterMin: 0, sinceMin: 0 });
  assert.strictEqual(three.secondMin, 420);
  assert.strictEqual(three.secondSleeper, true);
});

test("splitPair: первые 7h off duty — не sleeper, значит второй отдых ≥7h в sleeper", () => {
  const r = H.splitPair(PAIR_STATE, { firstMin: 420, firstSleeper: false, drivenAfterMin: 0, sinceMin: 0 });
  assert.strictEqual(r.secondMin, 420);
  assert.strictEqual(r.secondSleeper, true);
});

test("splitPair: первый отдых <2h — не пара, ≥10h — полный reset; остаток как без split", () => {
  const short = H.splitPair(PAIR_STATE, { firstMin: 90, firstSleeper: true, drivenAfterMin: 0, sinceMin: 0 });
  assert.deepStrictEqual([short.ok, short.reason], [false, "short"]);
  assert.deepStrictEqual(short.now, H.remaining(PAIR_STATE));
  assert.deepStrictEqual(short.state, H.normalize(PAIR_STATE));
  const full = H.splitPair(PAIR_STATE, { firstMin: 600, firstSleeper: true, drivenAfterMin: 0, sinceMin: 0 });
  assert.deepStrictEqual([full.ok, full.reason], [false, "full"]);
});

test("splitPair: несогласованный ввод зажимается в безопасную сторону", () => {
  // смена короче первого отдыха + времени после него → в окне считаем хотя бы время после отдыха;
  // вождение после отдыха больше вождения за смену → берём большее
  const r = H.splitPair({ drivenMin: 60, shiftMin: 300 }, { firstMin: 480, firstSleeper: true, drivenAfterMin: 200, sinceMin: 250 });
  assert.strictEqual(r.state.shiftMin, 250);
  assert.strictEqual(r.state.drivenMin, 200);
  assert.strictEqual(r.after.window, 840 - 250);
  assert.strictEqual(r.after.drive, 660 - 200);
});

test("splitPair: план по эффективному состоянию не нарушает окно (первый отдых не в окне)", () => {
  const r = H.splitPair(PAIR_STATE, { firstMin: 480, firstSleeper: true, drivenAfterMin: 120, sinceMin: 150 });
  const p = H.plan(r.state, { miles: 330, mph: 55, ...NO_DOCK });
  assert.deepStrictEqual(shape(p), ["drive:360"]);
});

// Recap: часы цикла по дням, days[0] = сегодня, days[i] = i дней назад.
const DAYS8 = (...d) => ({ cycle: "70-8", drivenMin: 0, shiftMin: 0, sinceBreakMin: 0, days: d });

test("normalize days: берёт 8 дней для 70/8 и 7 для 60/7, зажимает 0–24h, цикл = сумма", () => {
  const s = H.normalize({ cycle: "70-8", days: [60, -5, "120", 9999] });
  assert.deepStrictEqual(s.days, [60, 0, 120, 1440, 0, 0, 0, 0]);
  assert.strictEqual(s.cycleUsedMin, 1620);
  const s7 = H.normalize({ cycle: "60-7", days: [600, 600, 600, 600, 600, 600, 600, 600], cycleUsedMin: 5 });
  assert.strictEqual(s7.days.length, 7);
  assert.strictEqual(s7.cycleUsedMin, 3600);
  assert.ok(!("days" in H.normalize({ cycleUsedMin: 60 })));
});

test("remaining days: recapMin — часы самого старого дня, которые вернутся в полночь", () => {
  const r = H.remaining(DAYS8(0, 600, 600, 600, 600, 600, 600, 540));
  assert.strictEqual(r.cycle, 60);
  assert.strictEqual(r.recapMin, 540);
  assert.ok(!("recapMin" in H.remaining(FRESH)));
});

test("plan days: цикл исчерпан, recap в полночь ближе 34h → ждём полночь вместо restart", () => {
  const p = H.plan(DAYS8(0, 540, 540, 540, 540, 540, 540, 960), { miles: 110, mph: 55, clockMin: 22 * 60, ...NO_DOCK });
  assert.deepStrictEqual(shape(p), ["recap:120", "drive:120"]);
  assert.strictEqual(p.restarts, 0);
  assert.strictEqual(p.recaps, 1);
  assert.strictEqual(p.restMin, 120);
});

test("plan days: полночь в пути возвращает часы — едем без restart", () => {
  const st = DAYS8(0, 600, 600, 600, 600, 600, 600, 540);
  const p = H.plan(st, { miles: 275, mph: 55, clockMin: 23 * 60 + 30, ...NO_DOCK });
  assert.deepStrictEqual(shape(p), ["drive:300"]);
  // без дней тот же цикл (60 мин) упирается в restart
  const flat = H.plan({ cycleUsedMin: 4140 }, { miles: 275, mph: 55, ...NO_DOCK });
  assert.strictEqual(flat.restarts, 1);
});

test("plan days: recap дальше 34h → обычный restart", () => {
  const p = H.plan(DAYS8(600, 600, 600, 600, 600, 600, 600, 0), { miles: 55, mph: 55, clockMin: 1, ...NO_DOCK });
  assert.deepStrictEqual(shape(p), ["restart:2040", "drive:60"]);
  assert.strictEqual(p.recaps, 0);
});

test("plan days: цикл и окно кончились, полночь ближе 10h → 10h reset, за него часы вернулись", () => {
  const st = { ...DAYS8(600, 540, 540, 540, 540, 540, 540, 360), drivenMin: 600, shiftMin: 840 };
  const p = H.plan(st, { miles: 55, mph: 55, clockMin: 20 * 60, ...NO_DOCK });
  assert.deepStrictEqual(shape(p), ["reset:600", "drive:60"]);
});

test("plan days: долгий рейс с днями завершается", () => {
  const p = H.plan(DAYS8(0, 600, 600, 600, 600, 600, 600, 600), { miles: 5000, mph: 30, clockMin: 8 * 60, ...NO_DOCK });
  assert.strictEqual(p.driveMin, 10000);
  assert.ok(p.segments.length < 200);
});

test("splitPair days: дни цикла сохраняются в эффективном состоянии (план считает recap)", () => {
  const st = { ...DAYS8(600, 600, 600, 600, 600, 600, 600, 300), drivenMin: 300, shiftMin: 600 };
  const pair = H.splitPair(st, { firstMin: 480, firstSleeper: true, drivenAfterMin: 0, sinceMin: 0 });
  assert.deepStrictEqual(pair.state.days, st.days);
  assert.strictEqual(pair.now.recapMin, 300);
});
