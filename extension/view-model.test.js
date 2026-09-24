const test = require("node:test");
const assert = require("node:assert");
require("../shared/load.model.js");   // globalThis.LLMODEL
require("../shared/planner.js");      // globalThis.LLPLAN
const LLVIEW = require("./view-model.js");

const NOW = Date.parse("2026-09-24T15:00:00Z");
const look = (over = {}) => ({
  laneMedianOf: () => null, rep: () => null, strength: () => 0.6, density: () => 0,
  age: () => null, brokerBadge: () => ({ level: "unknown" }), ...over,
});
const load = (over = {}) => ({
  loadId: "L1", resultId: "abc+row1", originMarket: "DALLAS_TX", destMarket: "ATLANTA_GA", equipment: "V",
  rate: 2400, loadedMiles: 780, deadheadMiles: 20, brokerName: "Acme", brokerMc: "123456", ...over,
});
const input = (over = {}) => ({
  board: "dat", loads: [], pool: [], chains: [], deals: [], start: "DALLAS_TX", dieselPrice: 3.9, costPerMile: 1.8,
  equipFilter: null, autoRefreshOn: false, cloud: false, sseLive: false, sortPref: null,
  sortFields: [{ field: "rate", label: "Rate" }], drivers: [], activeDriverId: null, hintsOff: false,
  detailLoad: null, detailFacts: null, now: NOW, look: look(), ...over,
});

test("header: драйверы, фильтр прицепа, дизель, сортировка по умолчанию", () => {
  const s = LLVIEW.build(input({
    equipFilter: ["V", "R"], activeDriverId: 7,
    drivers: [{ id: 7, name: "Bob", currentMarket: "DALLAS_TX", equipment: "V" }, { id: 8, name: "Ann" }],
  }));
  assert.deepStrictEqual(s.header.drivers, [{ id: "7", label: "Bob · DALLAS_TX · V" }, { id: "8", label: "Ann" }]);
  assert.strictEqual(s.header.activeDriverId, "7");
  assert.strictEqual(s.header.equipFilter, "V, R");
  assert.strictEqual(s.header.diesel, "3.90");
  assert.deepStrictEqual(s.header.sort, { field: "", dir: "desc" });
  assert.strictEqual(s.detail, null);
});

test("chains: живое плечо (груз в выдаче) и прогнозное (крауд) с медианой и силой рынка", () => {
  const live = load();
  const crowd = load({ loadId: "C1", resultId: undefined, originMarket: "ATLANTA_GA", destMarket: "CHICAGO_IL", lastSeen: new Date(NOW).toISOString() });
  const chain = {
    hosBadge: "green", chainNetRpm: 2.1, totalNet: 1500, totalMiles: 1500, totalDriveMin: 1500, totalIdleMin: 0,
    finalMarket: "CHICAGO_IL",
    legs: [
      { loadId: "L1", origin: "DALLAS_TX", dest: "ATLANTA_GA", equipment: "V", rate: 2400, loadedMiles: 780, deadhead: 20, hosBadge: "green" },
      { loadId: "C1", origin: "ATLANTA_GA", dest: "CHICAGO_IL", equipment: "V", rate: 1800, loadedMiles: 720, deadhead: 0, hosBadge: "amber" },
    ],
  };
  const s = LLVIEW.build(input({
    loads: [live], pool: [live, crowd], chains: [chain],
    look: look({ laneMedianOf: (o, d) => (o === "ATLANTA_GA" && d === "CHICAGO_IL" ? 2.5 : null), density: (m) => (m === "ATLANTA_GA" ? 3 : 0), strength: () => 0.8 }),
  }));
  const [c] = s.chains;
  assert.strictEqual(c.path, "DALLAS_TX → ATLANTA_GA → CHICAGO_IL");
  assert.strictEqual(c.hos, "green");
  assert.match(c.meta, /^\$2\.10\/mi · net \$1500 · ~/);
  const [l0, l1] = c.legs;
  assert.strictEqual(l0.kind, "live");
  assert.strictEqual(l0.resultId, "abc+row1");
  assert.strictEqual(l0.eco, "$2,400 · 780mi +20dh · $3.00/mi · HOS ✓");
  assert.strictEqual(l1.kind, "forecast");
  assert.strictEqual(l1.fresh, "seen today");
  assert.strictEqual(l1.eco, "$2.50/mi lane median · ~3 loads from market · dest. market ▰▰▰▰▱ · HOS !");
});

test("chips живого плеча: возраст, брокер по CS, pickup today, Book Now", () => {
  const l = load({ bookNow: true, availability: { earliest: new Date(NOW).toISOString() }, weight: 42000, lengthFt: 53 });
  const chain = { hosBadge: "green", chainNetRpm: 3, totalNet: 1, finalMarket: "ATLANTA_GA",
    legs: [{ loadId: "L1", origin: "DALLAS_TX", dest: "ATLANTA_GA", equipment: "V", rate: 2400, loadedMiles: 780, deadhead: 20, hosBadge: "green" }] };
  const s = LLVIEW.build(input({
    loads: [l], pool: [l], chains: [chain],
    look: look({ age: () => 12, brokerBadge: () => ({ level: "good", creditScore: 95 }) }),
  }));
  assert.deepStrictEqual(s.chains[0].legs[0].chips, [
    { text: "🕒 12m", cls: "good" },
    { text: "Acme · 🛡 trusted 95CS", cls: "good" },
    { text: "pickup today", cls: "" },
    { text: "42klb · 53ft", cls: "" },
    { text: "Book Now", cls: "book" },
  ]);
});

test("deals: loadId строкой, возраст и $/mi", () => {
  const s = LLVIEW.build(input({ deals: [{ l: load({ loadId: 5 }), b: { netRpm: 2.346 } }], look: look({ age: () => 75 }) }));
  assert.deepStrictEqual(s.deals, [{ loadId: "5", lane: "DALLAS_TX → ATLANTA_GA V", age: "1h", rpm: "2.35" }]);
});

const facts = (over = {}) => ({
  laneMedian: 2.5, profit: { level: "green", netRpm: 2.4 }, hos: "green", broker: { creditScore: 92, daysToPay: 30 },
  rep: null, flags: [], flagLevel: null, trueRpm: 3.0, offer: { ask: 2650, script: "Could you do $2,650?" },
  fleet: null, mail: { url: "https://mail.google.com/x", text: "Subj\n\nBody" }, ...over,
});

test("detail: строки, контакты, primary-кнопка по preferredContactMethod", () => {
  const l = load({ contactPhone: "555-1", contactEmail: "a@b.co", preferredContactMethod: "PHONE", bookingUrl: "https://book.me/1", comments: "60ft" });
  const s = LLVIEW.build(input({ loads: [l], detailLoad: l, detailFacts: facts() }));
  const d = s.detail;
  assert.strictEqual(d.loadId, "L1");
  assert.strictEqual(d.title, "DALLAS_TX → ATLANTA_GA · V");
  assert.deepStrictEqual(d.rows.find((r) => r.k === "Phone"), { k: "Phone", v: "555-1", href: "tel:555-1" });
  assert.strictEqual(d.rows.find((r) => r.k === "Ask").v, "Could you do $2,650?");
  assert.strictEqual(d.comments, "60ft");
  assert.deepStrictEqual(d.actions.book, { url: "https://book.me/1", label: "Open ↗" });
  assert.deepStrictEqual(d.actions.mail, { url: "https://mail.google.com/x", primary: false });
  assert.deepStrictEqual(d.actions.call, { href: "tel:555-1", primary: true });
  assert.strictEqual(d.actions.copyEmail, "Subj\n\nBody");
  assert.strictEqual(d.actions.brokerMc, "123456");
  assert.match(d.actions.copy, /^DALLAS_TX → ATLANTA_GA V\nRate: \$2400/);
});

test("detail: javascript:-bookingUrl отбрасывается, неполный груз не падает", () => {
  const l = { loadId: "X", originMarket: "A", destMarket: "B", equipment: "V", rate: null, bookingUrl: "javascript:alert(1)" };
  const d = LLVIEW.build(input({ detailLoad: l, detailFacts: facts({ trueRpm: null, profit: { level: "unknown", netRpm: null }, offer: { ask: null }, mail: null, broker: {} }) })).detail;
  assert.strictEqual(d.actions.book, null);
  assert.strictEqual(d.actions.mail, null);
  assert.strictEqual(d.actions.brokerMc, null);
  assert.strictEqual(d.rows.find((r) => r.k === "Rate").v, "—");
});

test("detail: разбивка по парку", () => {
  const fleet = { feasibleCount: 1, total: 2, matches: [
    { feasible: true, name: "Bob", hosBadge: "green", equipMatch: true, deadhead: 12, netRpm: 2.1 },
    { feasible: false, name: "Ann", hosBadge: "red", equipMatch: false, deadhead: 300, netRpm: null },
  ] };
  const d = LLVIEW.build(input({ detailLoad: load(), detailFacts: facts({ fleet }) })).detail;
  assert.deepStrictEqual(d.fleet, { title: "Fits drivers (1/2)", rows: [
    { ok: true, text: "✓ Bob · HOS green · DH 12mi · $2.10/mi" },
    { ok: false, text: "✕ Ann · HOS red · equipment mismatch · DH 300mi" },
  ] });
});

test("снапшот сериализуем без потерь (уходит через port.postMessage)", () => {
  const l = load();
  const s = LLVIEW.build(input({ loads: [l], pool: [l], deals: [{ l, b: { netRpm: 2 } }], detailLoad: l, detailFacts: facts() }));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(s)), s);
});

test("форматтеры бейджей", () => {
  assert.strictEqual(LLVIEW.profitText({ level: "green", netRpm: 2.5 }), "▲ profitable · $2.50/mi");
  assert.strictEqual(LLVIEW.profitText({ level: "unknown" }), "— no rate");
  assert.strictEqual(LLVIEW.hosIcon("amber"), "!");
  assert.strictEqual(LLVIEW.crowdText({ n: 3, level: "good", paid: 2, noIssue: 1 }), "👥 3/3 ok");
  assert.strictEqual(LLVIEW.crowdText(null), "👥 +review");
  assert.strictEqual(LLVIEW.safeHttpUrl("data:text/html,x"), null);
});
