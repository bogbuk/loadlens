const test = require("node:test");
const assert = require("node:assert");

// Заглушка LLAPI до require alerts.js (модуль читает глобальный LLAPI).
let _status = { linked: true, enabled: true, configured: true };
let _sent = [];
globalThis.LLAPI = {
  telegramStatus: async () => _status,
  notifyAlerts: async (items) => { _sent.push(items); return { sent: items.length }; },
};
const LLALERT = require("./alerts.js");

const LOAD = {
  board: "dat", originMarket: "CHICAGO_IL", destMarket: "DALLAS_TX", equipment: "R",
  rate: 2400, loadedMiles: 980, deadheadMiles: 40, brokerMc: "MC-123456", creditScore: 92,
};

test("keyFor: семантический ключ, MC только цифры", () => {
  assert.strictEqual(LLALERT.keyFor(LOAD), "dat|CHICAGO_IL>DALLAS_TX|R|2400|980|123456");
});

test("toPayload: бизнес-поля + имя брокера, MC нормализован, сырой contact не уходит", () => {
  const p = LLALERT.toPayload({ ...LOAD, brokerName: "Axle Logistics", contact: "x" });
  assert.deepStrictEqual(p, {
    dedupKey: "dat|CHICAGO_IL>DALLAS_TX|R|2400|980|123456",
    originMarket: "CHICAGO_IL", destMarket: "DALLAS_TX", equipment: "R",
    rate: 2400, loadedMiles: 980, deadheadMiles: 40, brokerMc: "123456",
    brokerName: "Axle Logistics", creditScore: 92,
  });
  assert.strictEqual(p.contact, undefined);
});

test("toPayload: comments пробрасывается, переводы строк схлопываются, длина ограничена", () => {
  const p = LLALERT.toPayload({ ...LOAD, comments: "Lane.Jones@axlelogistics.com //\n60.25ft long" });
  assert.strictEqual(p.comments, "Lane.Jones@axlelogistics.com // 60.25ft long");
  const long = LLALERT.toPayload({ ...LOAD, comments: "x".repeat(500) });
  assert.strictEqual(long.comments.length, 300);
});

test("toPayload: дата пикапа и контакт брокера пробрасываются", () => {
  const p = LLALERT.toPayload({
    ...LOAD,
    availability: { earliest: "2026-06-14", latest: "2026-06-15" },
    contactEmail: "ops@broker.test", contactPhone: "555-123-4567",
  });
  assert.strictEqual(p.pickupDate, "2026-06-14");
  assert.strictEqual(p.contactEmail, "ops@broker.test");
  assert.strictEqual(p.contactPhone, "555-123-4567");
});

test("validItem: отсекает без рынка/миль; ставка не обязательна", () => {
  assert.ok(LLALERT.validItem(LLALERT.toPayload(LOAD)));
  assert.ok(!LLALERT.validItem(LLALERT.toPayload({ ...LOAD, loadedMiles: 0 })));
  assert.ok(!LLALERT.validItem(LLALERT.toPayload({ ...LOAD, originMarket: "" })));
});

test("validItem: груз без ставки (call for rate) проходит, rate уходит как 0", () => {
  const p = LLALERT.toPayload({ ...LOAD, rate: null });
  assert.strictEqual(p.rate, 0);
  assert.ok(LLALERT.validItem(p));
});

test("push: гейт — без linked/enabled/configured ничего не шлём", async () => {
  _sent = [];
  LLALERT._setStatus({ linked: false, enabled: true, configured: true });
  const r = await LLALERT.push([LOAD]);
  assert.strictEqual(r.sent, 0);
  assert.strictEqual(_sent.length, 0);
});

test("push: новый груз уходит; повтор в той же сессии — дедуп (сеть не дёргаем)", async () => {
  _sent = [];
  LLALERT._setStatus({ linked: true, enabled: true, configured: true });
  const r1 = await LLALERT.push([LOAD]);
  assert.strictEqual(r1.sent, 1);
  assert.strictEqual(_sent.length, 1);
  assert.strictEqual(_sent[0][0].dedupKey, "dat|CHICAGO_IL>DALLAS_TX|R|2400|980|123456");

  const r2 = await LLALERT.push([LOAD]);          // тот же груз
  assert.strictEqual(r2.sent, 0);
  assert.strictEqual(_sent.length, 1);            // второго запроса не было
});

test("toPayload: ruleName пробрасывается (обрезка 60, без переводов строк); без rule — поля нет", () => {
  const p = LLALERT.toPayload(LOAD, { id: "r", name: "Bonded /\nTWIC" });
  assert.strictEqual(p.ruleName, "Bonded / TWIC");
  const long = LLALERT.toPayload(LOAD, { id: "r", name: "x".repeat(100) });
  assert.strictEqual(long.ruleName.length, 60);
  assert.strictEqual(LLALERT.toPayload(LOAD).ruleName, undefined);
  assert.strictEqual(LLALERT.toPayload(LOAD, { id: "r", name: "" }).ruleName, undefined);
});

test("push: принимает {load, rule} и голый груз; ruleName уходит на сервер", async () => {
  _sent = [];
  LLALERT._setStatus({ linked: true, enabled: true, configured: true });
  const other = { ...LOAD, rate: 2600 };
  const r = await LLALERT.push([{ load: { ...LOAD, rate: 2500 }, rule: { id: "r", name: "Bonded" } }, other]);
  assert.strictEqual(r.sent, 2);
  assert.strictEqual(_sent[0][0].ruleName, "Bonded");
  assert.strictEqual(_sent[0][1].ruleName, undefined);
  assert.strictEqual(_sent[0][1].rate, 2600);
});

// ---- свежесть постинга ----

test("toPayload: возраст постинга уходит в минутах (servicedWhen точнее postedAge)", () => {
  const now = Date.now();
  const iso = new Date(now - 12 * 60000).toISOString();
  assert.strictEqual(LLALERT.toPayload({ ...LOAD, servicedWhen: iso }).ageMinutes, 12);
  assert.strictEqual(LLALERT.toPayload({ ...LOAD, postedAge: 40 }).ageMinutes, 40);
  assert.strictEqual(LLALERT.toPayload(LOAD).ageMinutes, undefined);   // возраст неизвестен — поля нет
});

test("push: свежие уходят первыми (потолок батча срезает протухшие, а не свежие)", async () => {
  _sent = [];
  LLALERT._setStatus({ linked: true, enabled: true, configured: true });
  const stale = { ...LOAD, rate: 3100, postedAge: 300 };
  const fresh = { ...LOAD, rate: 3200, postedAge: 3 };
  const unknown = { ...LOAD, rate: 3300 };
  const r = await LLALERT.push([stale, unknown, fresh]);
  assert.strictEqual(r.sent, 3);
  assert.deepStrictEqual(_sent[0].map((i) => i.rate), [3200, 3100, 3300]);
});
