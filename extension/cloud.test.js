const test = require("node:test");
const assert = require("node:assert");
const LLCLOUD = require("./cloud.js");

function fakeSS(init) {
  const store = { ...(init || {}) };
  return { store, getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
}
const MIN = 60000;

test("config: только mode:true + непустой instanceId", () => {
  assert.deepStrictEqual(LLCLOUD.config({ LL_CLOUD: { mode: true, instanceId: "abc" } }), { instanceId: "abc" });
  assert.strictEqual(LLCLOUD.config({ LL_CLOUD: { mode: false, instanceId: "abc" } }), null);
  assert.strictEqual(LLCLOUD.config({ LL_CLOUD: { mode: true, instanceId: "" } }), null);
  assert.strictEqual(LLCLOUD.config({}), null);
  assert.strictEqual(LLCLOUD.config(null), null);
});

test("clientIdFor: cloud → cloud:<id>, иначе локальный id", () => {
  assert.strictEqual(LLCLOUD.clientIdFor({ instanceId: "abc" }, "local-1"), "cloud:abc");
  assert.strictEqual(LLCLOUD.clientIdFor(null, "local-1"), "local-1");
});

test("detectState: страница логина → logged_out независимо от FindLoads", () => {
  assert.strictEqual(LLCLOUD.detectState({ hostname: "login.dat.com", lastFindLoadsAt: 1000, now: 1000, intervalMs: MIN }), "logged_out");
});

test("detectState: FindLoads в пределах 3 интервалов → ok, дольше → stale, никогда → stale", () => {
  const now = 10 * MIN;
  assert.strictEqual(LLCLOUD.detectState({ hostname: "one.dat.com", lastFindLoadsAt: now - 2 * MIN, now, intervalMs: MIN }), "ok");
  assert.strictEqual(LLCLOUD.detectState({ hostname: "one.dat.com", lastFindLoadsAt: now - 3 * MIN, now, intervalMs: MIN }), "ok");
  assert.strictEqual(LLCLOUD.detectState({ hostname: "one.dat.com", lastFindLoadsAt: now - 3 * MIN - 1, now, intervalMs: MIN }), "stale");
  assert.strictEqual(LLCLOUD.detectState({ hostname: "one.dat.com", lastFindLoadsAt: null, now, intervalMs: MIN }), "stale");
});

test("detectState: интервал меньше 60с поднимается до 60с (как в авто-пилоте)", () => {
  const now = 10 * MIN;
  assert.strictEqual(LLCLOUD.detectState({ hostname: "one.dat.com", lastFindLoadsAt: now - 2.5 * MIN, now, intervalMs: 1000 }), "ok");
});

test("heartbeat: собирает payload, loadsSeen не отрицательный и целый", () => {
  const now = 10 * MIN;
  assert.deepStrictEqual(
    LLCLOUD.heartbeat({ hostname: "one.dat.com", lastFindLoadsAt: now - MIN, now, intervalMs: MIN, loadsSeen: 12.7 }),
    { state: "ok", loadsSeen: 12, lastFindLoadsAt: now - MIN },
  );
  assert.deepStrictEqual(
    LLCLOUD.heartbeat({ hostname: "login.dat.com", lastFindLoadsAt: null, now, intervalMs: MIN, loadsSeen: -3 }),
    { state: "logged_out", loadsSeen: 0, lastFindLoadsAt: null },
  );
});

test("markFindLoads/lastFindLoads: метка переживает reload через sessionStorage", () => {
  const ss = fakeSS();
  assert.strictEqual(LLCLOUD.lastFindLoads(ss), null);
  LLCLOUD.markFindLoads(ss, 12345);
  assert.strictEqual(LLCLOUD.lastFindLoads(ss), 12345);
  assert.strictEqual(LLCLOUD.lastFindLoads(null), null);
  assert.doesNotThrow(() => LLCLOUD.markFindLoads(null, 1));
});

test("due: первый heartbeat — сразу; повтор — через HEARTBEAT_MS; смена состояния — сразу", () => {
  const ss = fakeSS();
  assert.strictEqual(LLCLOUD.due(ss, 1000, "ok"), true);
  LLCLOUD.markHeartbeat(ss, 1000, "ok");
  assert.strictEqual(LLCLOUD.due(ss, 1000 + LLCLOUD.HEARTBEAT_MS - 1, "ok"), false);
  assert.strictEqual(LLCLOUD.due(ss, 1000 + LLCLOUD.HEARTBEAT_MS, "ok"), true);
  assert.strictEqual(LLCLOUD.due(ss, 2000, "logged_out"), true); // состояние сменилось → немедленно
  assert.strictEqual(LLCLOUD.due(null, 2000, "ok"), true);       // нет storage → шлём
});

test("tickHeartbeat: метка ставится ТОЛЬКО после успешной отправки; при неудаче — повтор на следующем тике", async () => {
  const ss = fakeSS();
  const hb = { state: "ok", loadsSeen: 5, lastFindLoadsAt: 900 };
  let calls = 0;
  // без JWT / сеть упала → send отдаёт false → метки нет → через минуту due снова true
  const r1 = await LLCLOUD.tickHeartbeat({ ss, now: 1000, hb, send: async () => { calls++; return false; } });
  assert.strictEqual(r1, "failed");
  assert.strictEqual(LLCLOUD.due(ss, 1000 + 60000, "ok"), true);
  // успех → метка стоит → следующие 5 минут не шлём
  const r2 = await LLCLOUD.tickHeartbeat({ ss, now: 61000, hb, send: async () => { calls++; return true; } });
  assert.strictEqual(r2, "sent");
  assert.strictEqual(calls, 2);
  const r3 = await LLCLOUD.tickHeartbeat({ ss, now: 61000 + 60000, hb, send: async () => { calls++; return true; } });
  assert.strictEqual(r3, "skipped");
  assert.strictEqual(calls, 2);
  // send бросил → тоже failed, не пробрасываем
  const r4 = await LLCLOUD.tickHeartbeat({ ss, now: 61000 + LLCLOUD.HEARTBEAT_MS, hb, send: async () => { throw new Error("x"); } });
  assert.strictEqual(r4, "failed");
  assert.strictEqual(LLCLOUD.due(ss, 61000 + LLCLOUD.HEARTBEAT_MS + 60000, "ok"), true);
});
