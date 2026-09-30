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
