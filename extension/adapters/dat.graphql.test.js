const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

require("../../shared/load.model.js"); // глобал LLMODEL
const DAT_GQL = require("./dat.graphql.js");

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, "__fixtures__", "dat-findloads.json"), "utf8"),
);

test("parseFindLoads: маппит результаты в unified Load с lane groupKey", () => {
  const loads = DAT_GQL.parseFindLoads(fixture);
  assert.strictEqual(loads.length, 3);
  const a = loads[0];
  assert.strictEqual(a.board, "dat");
  assert.strictEqual(a.loadId, "POST-AAA-1");
  assert.strictEqual(a.originMarket, "CHICAGO_IL");
  assert.strictEqual(a.destMarket, "ATLANTA_GA");
  assert.strictEqual(a.equipment, "F");               // FLATBED → F
  assert.strictEqual(a.rate, 1950);                    // FLAT → тотал
  assert.strictEqual(a.loadedMiles, 716);
  assert.strictEqual(a.deadheadMiles, 22);
  assert.strictEqual(a.weight, 44000);
  assert.strictEqual(a.groupKey, "dat|CHICAGO_IL>ATLANTA_GA|F");
});

test("PER_MILE basis → ставка пересчитывается в тотал (rateUsd * trip miles)", () => {
  const loads = DAT_GQL.parseFindLoads(fixture);
  const b = loads[1];
  assert.strictEqual(b.equipment, "V");                // VAN → V
  assert.strictEqual(b.rate, Math.round(1.95 * 925));  // 1804
});

test("broker-trust поля переносятся (MC, credit, daysToPay), PII в contact", () => {
  const a = DAT_GQL.parseFindLoads(fixture)[0];
  assert.strictEqual(a.brokerMc, "MC-555000");
  assert.strictEqual(a.brokerName, "Acme Freight Brokers");
  assert.strictEqual(a.creditScore, 92);
  assert.strictEqual(a.daysToPay, 28);
  assert.strictEqual(a.isFactorable, true);
  assert.strictEqual(a.contact, "ops@example-broker.test"); // PII — режется в LLAPI.sanitizeLoad
});

test("sanitizeLoad: сырой contact не уходит, brokerMc/credit — уходят (полный whitelist 2026-07-17)", () => {
  const LLAPI = require("../api.js");
  const a = DAT_GQL.parseFindLoads(fixture)[0];
  const clean = LLAPI.sanitizeLoad(a);
  assert.strictEqual(clean.contact, undefined);       // legacy-агрегат не в whitelist
  assert.strictEqual(clean.creditScore, 92);          // broker-trust теперь в крауд
  assert.strictEqual(clean.brokerMc, "MC-555000");
  assert.strictEqual(clean.originMarket, "CHICAGO_IL");
});

test("поля детали: comments, availability, rateBasis, контакты, bookingUrl/bookNow", () => {
  const [a, b] = DAT_GQL.parseFindLoads(fixture);
  assert.strictEqual(a.comments, "Tarp required. Load by 14:00. No-touch.");
  assert.deepStrictEqual(a.availability, { earliest: "2026-06-14", latest: "2026-06-15" });
  assert.strictEqual(a.rateBasis, "FLAT");
  assert.strictEqual(a.contactEmail, "ops@example-broker.test");
  assert.strictEqual(a.contactPhone, "5551234567");
  assert.strictEqual(a.bookNow, false);
  // load 2 — bookable PER_MILE с bookingUrl
  assert.strictEqual(b.rateBasis, "PER_MILE");
  assert.strictEqual(b.bookingUrl, "https://example.test/book");
});

test("реальная форма: comments-массив → строка, contactMethods/assurable/tia/servicedWhen", () => {
  const c = DAT_GQL.parseFindLoads(fixture)[2];
  assert.strictEqual(c.loadId, "POST-CCC-3");
  // comments приходит МАССИВом — нормализуем в строку через " · "
  assert.strictEqual(c.comments, "TWIC CARD NEEDED - RATE ALL IN - PU AND DEL FCFS · Load Id:11174602");
  assert.strictEqual(c.isAssurable, true);
  assert.strictEqual(c.hasTiaMembership, true);
  assert.strictEqual(c.creditAsOf, "2026-05-01");
  assert.strictEqual(c.servicedWhen, "2026-06-29T20:04:21.689Z");
  assert.strictEqual(c.postingExpiresWhen, "2026-07-03T21:44:17.225Z");
  assert.strictEqual(c.brokerCity, "Tomball");
  assert.strictEqual(c.brokerState, "TX");
  assert.strictEqual(c.preferredContactMethod, "PRIMARY_PHONE");
  // equipment: гранулярный код DAT "DD" → группа K (подтверждено: поиск classes:["K"]); raw сохранён
  assert.strictEqual(c.equipment, "K");
  assert.strictEqual(c.equipmentCode, "DD");
  assert.strictEqual(c.groupKey, "dat|NEW_YORK_NY>NASHWAUK_MN|K");
  assert.strictEqual(c.fullPartial, "FULL");
  assert.strictEqual(c.tripMethod, "ROAD");
  assert.strictEqual(c.destDeadheadMiles, 12);
  assert.strictEqual(c.carrierMc, "MC-166960");
  assert.strictEqual(c.combinedOfficeId, 21143);
  assert.strictEqual(c.bidCount, 0);
  // legacy contact.* пустой → берём из contactMethods[] (фолбэк)
  assert.strictEqual(c.contactPhone, "5550001111");
  assert.strictEqual(c.contactEmail, "ops@example-hh.test");
  assert.strictEqual(c.contact, "ops@example-hh.test"); // email приоритетнее phone для PII-поля
  assert.ok(Array.isArray(c.contactMethods) && c.contactMethods.length === 2);
});

test("sanitizeLoad: контакты уходят плоскими полями (решение 2026-07-17), структурный contactMethods — нет", () => {
  const LLAPI = require("../api.js");
  const clean = LLAPI.sanitizeLoad(DAT_GQL.parseFindLoads(fixture)[2]);
  assert.strictEqual(clean.contact, undefined);        // legacy-агрегат не в whitelist
  assert.strictEqual(clean.contactMethods, undefined); // структурный массив не в whitelist
  assert.strictEqual(clean.contactEmail, "ops@example-hh.test");
  assert.strictEqual(clean.contactPhone, "5550001111");
  assert.strictEqual(clean.combinedOfficeId, "21143"); // id приведён к строке
  assert.strictEqual(clean.equipmentCode, "DD");
});

test("parseFindLoadsResult отдаёт searchId/hasNext; parseFindLoads — те же loads", () => {
  const res = DAT_GQL.parseFindLoadsResult(fixture);
  assert.strictEqual(res.searchId, "synthetic-search-1");
  assert.strictEqual(res.hasNext, false);                       // в фикстуре нет cursors.next
  assert.strictEqual(res.loads.length, 3);
  assert.deepStrictEqual(res.loads, DAT_GQL.parseFindLoads(fixture)); // обёртка = .loads
  // hasNext=true когда есть курсор; мусор → пустой результат без падения
  assert.strictEqual(DAT_GQL.parseFindLoadsResult({ data: { freightSearchV4: { findLoads: {
    __typename: "FreightSearchV4FindLoadsSuccess", searchId: "S9", results: [], cursors: { next: "abc" } } } } }).hasNext, true);
  assert.deepStrictEqual(DAT_GQL.parseFindLoadsResult({ data: {} }), { loads: [], searchId: null, hasNext: false });
});

test("isFindLoadsResponse распознаёт ответ; мусор → []", () => {
  assert.strictEqual(DAT_GQL.isFindLoadsResponse(fixture), true);
  assert.strictEqual(DAT_GQL.isFindLoadsResponse({ data: {} }), false);
  assert.deepStrictEqual(DAT_GQL.parseFindLoads({ data: {} }), []);
});

// --- Load Match Alerts (SSE liveQueryMatches): событие → {action, load}. Спайк 2026-09-15.
const matchFx = JSON.parse(
  fs.readFileSync(path.join(__dirname, "__fixtures__", "dat-match-event.json"), "utf8"),
);

test("parseMatchEvent: LOAD_MATCH_CREATED → create + полный Load (та же форма, что findLoads.results)", () => {
  const r = DAT_GQL.parseMatchEvent(matchFx.created);
  assert.strictEqual(r.action, "create");
  assert.strictEqual(r.loadId, "POST-SSE-1");
  assert.strictEqual(r.load.loadId, "POST-SSE-1");
  assert.strictEqual(r.load.originMarket, "MUNCIE_IN");
  assert.strictEqual(r.load.destMarket, "DALLAS_TX");
  assert.strictEqual(r.load.equipment, "V");
  assert.strictEqual(r.load.rate, 2600);
  assert.strictEqual(r.load.loadedMiles, 960);
  assert.strictEqual(r.load.deadheadMiles, 35);
  assert.strictEqual(r.load.brokerMc, "MC-000111");
  assert.strictEqual(r.load.creditScore, 96);
  assert.strictEqual(r.load.contactEmail, "dispatch@example.invalid");
  assert.strictEqual(r.load.comments, "Drop trailer ok");
  assert.strictEqual(r.load.fromMatchAlert, true);
});

test("parseMatchEvent: LOAD_MATCH_UPDATED (redacted, без ставки/брокера) → update, rate null, estimatedRatePerMile есть", () => {
  const r = DAT_GQL.parseMatchEvent(matchFx.updated_redacted);
  assert.strictEqual(r.action, "update");
  assert.strictEqual(r.load.loadId, "POST-SSE-2");
  assert.strictEqual(r.load.rate, null);
  assert.strictEqual(r.load.estimatedRatePerMile, 2.1);
  assert.strictEqual(r.load.brokerMc, null);
  assert.deepStrictEqual(r.load.redactionReasons, ["UNMET_PREFERENCE", "QUALIFICATION"]);
});

test("parseMatchEvent: LOAD_MATCH_CANCELLED → cancel + loadId, без Load", () => {
  const r = DAT_GQL.parseMatchEvent(matchFx.cancelled);
  assert.deepStrictEqual(r, { action: "cancel", loadId: "POST-SSE-1", load: null });
});

test("parseMatchEvent: data строкой JSON тоже принимается; чужое событие/мусор → null", () => {
  const r = DAT_GQL.parseMatchEvent({ event: "LOAD_MATCH_CREATED", data: JSON.stringify(matchFx.created.data) });
  assert.strictEqual(r.action, "create");
  assert.strictEqual(DAT_GQL.parseMatchEvent({ event: "__IMMINENT_DISCONNECT", data: {} }), null);
  assert.strictEqual(DAT_GQL.parseMatchEvent({ event: "LOAD_MATCH_CREATED", data: "not json" }), null);
  assert.strictEqual(DAT_GQL.parseMatchEvent({ event: "LOAD_MATCH_CREATED", data: { noAssetInfo: true } }), null);
  assert.strictEqual(DAT_GQL.parseMatchEvent(null), null);
});
