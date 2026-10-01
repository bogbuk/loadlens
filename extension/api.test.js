const test = require("node:test");
const assert = require("node:assert");

const LLAPI = require("./api.js");

const BASE_LOAD = {
  board: "dat", loadId: "L1", originMarket: "CHICAGO_IL", destMarket: "DALLAS_TX",
  equipment: "R", groupKey: "dat|CHICAGO_IL>DALLAS_TX|R",
  rate: 2400, loadedMiles: 980, deadheadMiles: 40, weight: 42000,
  brokerMc: "123456", brokerName: "Axle Logistics",
};

test("sanitizeLoad: null без обязательных полей", () => {
  assert.strictEqual(LLAPI.sanitizeLoad({ board: "dat", originMarket: "A" }), null);
  assert.ok(LLAPI.sanitizeLoad(BASE_LOAD));
});

test("sanitizeLoad: расширенные поля проходят (вкл. контакты и comments — решение 2026-07-17)", () => {
  const out = LLAPI.sanitizeLoad({
    ...BASE_LOAD,
    originCity: "Chicago", originState: "IL", destCity: "Dallas", destState: "TX",
    equipmentCode: "RGN", fullPartial: "FULL", creditScore: 97, daysToPay: 27.5,
    isAssurable: true, bookNow: false, bidCount: 0,
    comments: "Lane.Jones@axlelogistics.com // 60.25ft long",
    contactEmail: "ops@broker.test", contactPhone: "865-398-2058",
    preferredContactMethod: "EMAIL",
  });
  assert.strictEqual(out.originCity, "Chicago");
  assert.strictEqual(out.equipmentCode, "RGN");
  assert.strictEqual(out.creditScore, 97);
  assert.strictEqual(out.daysToPay, 27.5);
  assert.strictEqual(out.isAssurable, true);
  assert.strictEqual(out.bookNow, false);   // false не теряется
  assert.strictEqual(out.bidCount, 0);      // 0 не теряется
  assert.strictEqual(out.comments, "Lane.Jones@axlelogistics.com // 60.25ft long");
  assert.strictEqual(out.contactEmail, "ops@broker.test");
  assert.strictEqual(out.contactPhone, "865-398-2058");
});

test("sanitizeLoad: availability флаттенится в pickupEarliest/pickupLatest", () => {
  const out = LLAPI.sanitizeLoad({
    ...BASE_LOAD, availability: { earliest: "2026-07-17T00:00:00Z", latest: "2026-07-18T00:00:00Z" },
  });
  assert.strictEqual(out.pickupEarliest, "2026-07-17T00:00:00Z");
  assert.strictEqual(out.pickupLatest, "2026-07-18T00:00:00Z");
  assert.strictEqual(out.availability, undefined);
});

test("sanitizeLoad: id-поля приводятся к строке, comments клампится и чистится от \\n", () => {
  const out = LLAPI.sanitizeLoad({
    ...BASE_LOAD, dotNumber: 1234567, posterUserId: 42,
    comments: "line1\nline2 " + "x".repeat(600),
  });
  assert.strictEqual(out.dotNumber, "1234567");
  assert.strictEqual(out.posterUserId, "42");
  assert.ok(!out.comments.includes("\n"));
  assert.strictEqual(out.comments.length, 500);
});

test("sanitizeLoad: неизвестные поля не проходят (whitelist)", () => {
  const out = LLAPI.sanitizeLoad({ ...BASE_LOAD, contact: "raw", resultId: "abc+def", randomJunk: 1 });
  assert.strictEqual(out.contact, undefined);
  assert.strictEqual(out.resultId, undefined);
  assert.strictEqual(out.randomJunk, undefined);
});

// ---- cloud mode ----
function fakeChrome(store) {
  return { storage: { local: {
    get: async (k) => { const keys = Array.isArray(k) ? k : [k]; const o = {}; for (const x of keys) if (x in store) o[x] = store[x]; return o; },
    set: async (o) => { Object.assign(store, o); },
    remove: async (k) => { delete store[k]; },
  } } };
}

test("clientId: в cloud mode — cloud:<instanceId>, ll_cid не создаётся", async () => {
  const store = {};
  globalThis.chrome = fakeChrome(store);
  globalThis.LLCLOUD = require("./cloud.js");
  globalThis.LL_CLOUD = { mode: true, instanceId: "inst-1" };
  assert.strictEqual(await LLAPI.clientId(), "cloud:inst-1");
  assert.strictEqual(store.ll_cid, undefined);
  delete globalThis.LL_CLOUD;
  const id = await LLAPI.clientId();
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.strictEqual(store.ll_cid, id);
});

test("getMe: кэш из ll_auth отдаёт cloudEnabled", async () => {
  const store = { ll_auth: { accessToken: "a", refreshToken: "r", email: "x@y.z", plan: "pro", cloudEnabled: true, planTs: Date.now() } };
  globalThis.chrome = fakeChrome(store);
  assert.deepStrictEqual(await LLAPI.getMe(), { email: "x@y.z", plan: "pro", trialEndsAt: null, cloudEnabled: true,
                                                billing: false, subscription: null });
});

test("login: cloudEnabled переживает вход и отдаётся из кэша getMe", async () => {
  const store = {};
  globalThis.chrome = fakeChrome(store);
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ accessToken: "a", refreshToken: "r", user: { email: "x@y.z", plan: "pro", cloudEnabled: true } }),
  });
  try { await LLAPI.login("x@y.z", "pw"); } finally { globalThis.fetch = origFetch; }
  // fetch восстановлен → getMe обязан взять кэш ll_auth, а не ходить в сеть
  assert.strictEqual((await LLAPI.getMe()).cloudEnabled, true);
});

test("cloudHeartbeat: true только при 2xx; без логина / сеть / 5xx → false", async () => {
  globalThis.chrome = fakeChrome({ ll_auth: { accessToken: "a", refreshToken: "r", email: "x@y.z", plan: "pro", planTs: Date.now() } });
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
    assert.strictEqual(await LLAPI.cloudHeartbeat({ state: "ok", loadsSeen: 1, lastFindLoadsAt: 1 }), true);
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    assert.strictEqual(await LLAPI.cloudHeartbeat({ state: "ok", loadsSeen: 1, lastFindLoadsAt: 1 }), false);
    globalThis.fetch = async () => { throw new Error("offline"); };
    assert.strictEqual(await LLAPI.cloudHeartbeat({ state: "ok", loadsSeen: 1, lastFindLoadsAt: 1 }), false);
  } finally { globalThis.fetch = origFetch; }
  globalThis.chrome = fakeChrome({});
  assert.strictEqual(await LLAPI.cloudHeartbeat({ state: "ok", loadsSeen: 1, lastFindLoadsAt: 1 }), false);
});

test("cloudHeartbeat: без логина и при сетевой ошибке не бросает", async () => {
  globalThis.chrome = fakeChrome({});
  await assert.doesNotReject(LLAPI.cloudHeartbeat({ state: "ok", loadsSeen: 1, lastFindLoadsAt: 1 }));
  globalThis.chrome = fakeChrome({ ll_auth: { accessToken: "a", refreshToken: "r" } });
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try { await assert.doesNotReject(LLAPI.cloudHeartbeat({ state: "ok", loadsSeen: 1, lastFindLoadsAt: 1 })); }
  finally { globalThis.fetch = origFetch; }
});

test("getMe: кэш свежий (<24ч), но триал уже истёк — идём на сервер", async () => {
  const now = Date.now();
  const store = { ll_auth: { accessToken: "a", refreshToken: "r", email: "x@y.z", plan: "pro",
    trialEndsAt: now - 60000, planTs: now - 3600000 } };
  globalThis.chrome = fakeChrome(store);
  const origFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: true, status: 200,
    json: async () => ({ email: "x@y.z", plan: "free", trialEndsAt: now - 60000, cloudEnabled: false }) }; };
  try {
    const me = await LLAPI.getMe();
    assert.strictEqual(calls, 1);
    assert.strictEqual(me.plan, "free");
    assert.strictEqual(me.trialEndsAt, now - 60000);
    assert.strictEqual(store.ll_auth.plan, "free");
  } finally { globalThis.fetch = origFetch; }
});

test("getMe: триал ещё идёт — кэш используется, сеть не трогаем", async () => {
  const now = Date.now();
  globalThis.chrome = fakeChrome({ ll_auth: { accessToken: "a", refreshToken: "r", email: "x@y.z", plan: "pro",
    trialEndsAt: now + 86400000, planTs: now - 3600000 } });
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("no network expected"); };
  try { assert.strictEqual((await LLAPI.getMe()).trialEndsAt, now + 86400000); }
  finally { globalThis.fetch = origFetch; }
});

test("login: trialEndsAt сохраняется в ll_auth", async () => {
  const store = {};
  globalThis.chrome = fakeChrome(store);
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200,
    json: async () => ({ accessToken: "a", refreshToken: "r", user: { email: "x@y.z", plan: "pro", trialEndsAt: 123, cloudEnabled: false } }) });
  try { await LLAPI.login("x@y.z", "pw"); } finally { globalThis.fetch = origFetch; }
  assert.strictEqual(store.ll_auth.trialEndsAt, 123);
});

test("getMe: кэш отдаёт billing и подписку (кнопка Upgrade/Manage без запроса к серверу)", async () => {
  const sub = { status: "active", renewsAt: 1790000000000, endsAt: null };
  const store = { ll_auth: { accessToken: "a", refreshToken: "r", email: "x@y.z", plan: "pro", billing: true, subscription: sub, planTs: Date.now() } };
  globalThis.chrome = fakeChrome(store);
  const me = await LLAPI.getMe();
  assert.strictEqual(me.billing, true);
  assert.deepStrictEqual(me.subscription, sub);
});
