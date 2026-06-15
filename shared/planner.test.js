const test = require("node:test");
const assert = require("node:assert");
const LLPLAN = require("./planner.js");

// Полный HOS-ресурс свежего водителя (минуты).
const FRESH_HOS = { remainingDrive: 11 * 60, remainingOnDuty: 14 * 60, remainingCycle: 70 * 60 };

function load(o) {
  return {
    board: "dat", loadId: o.id, originMarket: o.from, destMarket: o.to,
    equipment: o.eq || "V", rate: o.rate, loadedMiles: o.mi, deadheadMiles: 0,
    groupKey: `dat|${o.from}>${o.to}|${o.eq || "V"}`,
  };
}

// Силы рынков: DALLAS сильный (легко выехать), DENVER — тупик.
const STRENGTH = { CHI: 0.6, DAL: 0.8, DEN: 0.2, LA: 0.5, ATL: 0.7 };
const strengthFn = (m) => STRENGTH[m] ?? 0.5;
const zeroDistance = () => 0; // грузы стыкуются без deadhead (origin == prev dest)

test("get-out: цепочка в сильный рынок обходит чуть доходнее в тупик", () => {
  const loads = [
    // одиночное плечо в тупик DENVER: чуть выше $/милю
    load({ id: "A", from: "CHI", to: "DEN", rate: 2100, mi: 1000 }),
    // плечо в сильный DALLAS чуть ниже $/милю, но оттуда есть продолжение
    load({ id: "B", from: "CHI", to: "DAL", rate: 2000, mi: 920 }),
    load({ id: "C", from: "DAL", to: "LA", rate: 1900, mi: 1400 }),
  ];
  const chains = LLPLAN.plan({
    start: { market: "CHI" }, hosState: FRESH_HOS, loads,
    distance: zeroDistance, marketStrength: strengthFn,
    dieselPrice: 4.0, maxLegs: 3,
  });
  assert.ok(chains.length > 0);
  // Лучшая цепочка должна заканчиваться НЕ в тупике DENVER.
  assert.notStrictEqual(chains[0].finalMarket, "DEN");
  // И должна предпочесть маршрут через DALLAS (сильный рынок).
  const top = chains[0];
  assert.ok(["DAL", "LA"].includes(top.finalMarket));
});

test("HOS-гейт отбрасывает плечо, превышающее остаток цикла", () => {
  // Почти исчерпанный цикл: остаётся 3 часа.
  const lowCycle = { remainingDrive: 11 * 60, remainingOnDuty: 14 * 60, remainingCycle: 3 * 60 };
  const loads = [
    // плечо ~22ч работы (1000 миль / 50mph + 2ч) — не лезет в 3ч цикла
    load({ id: "BIG", from: "CHI", to: "DAL", rate: 3000, mi: 1000 }),
  ];
  const chains = LLPLAN.plan({
    start: { market: "CHI" }, hosState: lowCycle, loads,
    distance: zeroDistance, marketStrength: strengthFn,
  });
  assert.strictEqual(chains.length, 0); // единственное плечо невыполнимо → нет цепочек
});

test("stepHos: плечо в смену — feasible green; сверх смены — reset amber; сверх цикла — red", () => {
  const fresh = { remainingDrive: 660, remainingOnDuty: 840, remainingCycle: 4200 };
  const ok = LLPLAN.stepHos(fresh, 300, 120);
  assert.strictEqual(ok.feasible, true);
  assert.strictEqual(ok.badge, "green");

  // драйв больше остатка смены, но влезает после reset и в цикл
  const tired = { remainingDrive: 60, remainingOnDuty: 90, remainingCycle: 4200 };
  const reset = LLPLAN.stepHos(tired, 300, 120);
  assert.strictEqual(reset.feasible, true);
  assert.strictEqual(reset.badge, "amber");
  assert.strictEqual(reset.idleMin, LLPLAN.HOS.RESET);

  // сверх цикла — невыполнимо
  const noCycle = { remainingDrive: 660, remainingOnDuty: 840, remainingCycle: 60 };
  const red = LLPLAN.stepHos(noCycle, 300, 120);
  assert.strictEqual(red.feasible, false);
  assert.strictEqual(red.badge, "red");
});

test("deadhead увеличивает мили и снижает chainNetRpm", () => {
  const loads = [load({ id: "D", from: "CHI", to: "ATL", rate: 2000, mi: 1000 })];
  const noDh = LLPLAN.plan({
    start: { market: "CHI" }, hosState: FRESH_HOS, loads,
    distance: () => 0, marketStrength: strengthFn, dieselPrice: 4.0,
  })[0];
  const withDh = LLPLAN.plan({
    start: { market: "CHI" }, hosState: FRESH_HOS, loads,
    distance: () => 200, marketStrength: strengthFn, dieselPrice: 4.0,
  })[0];
  assert.ok(withDh.totalMiles > noDh.totalMiles);
  assert.ok(withDh.chainNetRpm < noDh.chainNetRpm);
});

test("дедуп: два груза-близнеца по одному lane (разные loadId) схлопываются в одну строку", () => {
  // Брокер репостит лот / DAT отдаёт дубль под другим resultId — разные loadId, та же экономика.
  const loads = [
    load({ id: "X1", from: "CHI", to: "DAL", rate: 2000, mi: 920 }),
    load({ id: "X2", from: "CHI", to: "DAL", rate: 2000, mi: 920 }),
  ];
  const chains = LLPLAN.plan({
    start: { market: "CHI" }, hosState: FRESH_HOS, loads,
    distance: zeroDistance, marketStrength: strengthFn, dieselPrice: 4.0,
  });
  const toDal = chains.filter((c) => c.finalMarket === "DAL");
  assert.strictEqual(toDal.length, 1); // одна видимая строка, не две

  // А вот другая ставка по тому же lane — это РАЗНОЕ предложение, остаётся отдельно.
  const distinct = LLPLAN.plan({
    start: { market: "CHI" }, hosState: FRESH_HOS,
    loads: [
      load({ id: "Y1", from: "CHI", to: "DAL", rate: 2000, mi: 920 }),
      load({ id: "Y2", from: "CHI", to: "DAL", rate: 2600, mi: 920 }),
    ],
    distance: zeroDistance, marketStrength: strengthFn, dieselPrice: 4.0,
  });
  assert.strictEqual(distinct.filter((c) => c.finalMarket === "DAL").length, 2);
});

test("детерминизм: одинаковый вход → одинаковый выход", () => {
  const loads = [
    load({ id: "A", from: "CHI", to: "DAL", rate: 2000, mi: 920 }),
    load({ id: "C", from: "DAL", to: "LA", rate: 1900, mi: 1400 }),
  ];
  const opts = {
    start: { market: "CHI" }, hosState: FRESH_HOS, loads,
    distance: zeroDistance, marketStrength: strengthFn, dieselPrice: 4.0,
  };
  assert.deepStrictEqual(LLPLAN.plan(opts), LLPLAN.plan(opts));
});

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
