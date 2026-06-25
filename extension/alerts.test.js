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

test("toPayload: только бизнес-поля, MC нормализован, без PII-полей", () => {
  const p = LLALERT.toPayload({ ...LOAD, brokerName: "John +1 555 333", contact: "x" });
  assert.deepStrictEqual(p, {
    dedupKey: "dat|CHICAGO_IL>DALLAS_TX|R|2400|980|123456",
    originMarket: "CHICAGO_IL", destMarket: "DALLAS_TX", equipment: "R",
    rate: 2400, loadedMiles: 980, deadheadMiles: 40, brokerMc: "123456", creditScore: 92,
  });
  assert.strictEqual(p.brokerName, undefined);
  assert.strictEqual(p.contact, undefined);
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

test("validItem: отсекает без рынка/ставки/миль", () => {
  assert.ok(LLALERT.validItem(LLALERT.toPayload(LOAD)));
  assert.ok(!LLALERT.validItem(LLALERT.toPayload({ ...LOAD, rate: 0 })));
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
