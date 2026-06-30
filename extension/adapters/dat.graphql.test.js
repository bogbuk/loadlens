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

test("sanitizeLoad режет PII и НЕ шлёт contact, но шлёт brokerMc", () => {
  const LLAPI = require("../api.js");
  const a = DAT_GQL.parseFindLoads(fixture)[0];
  const clean = LLAPI.sanitizeLoad(a);
  assert.strictEqual(clean.contact, undefined);
  assert.strictEqual(clean.creditScore, undefined);   // не в whitelist (broker-trust шлём отдельно позже)
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

test("contactMethods/contact-PII режутся sanitizeLoad, бизнес-поля остаются", () => {
  const LLAPI = require("../api.js");
  const clean = LLAPI.sanitizeLoad(DAT_GQL.parseFindLoads(fixture)[2]);
  assert.strictEqual(clean.contact, undefined);
  assert.strictEqual(clean.contactMethods, undefined);
  assert.strictEqual(clean.contactEmail, undefined);
  assert.strictEqual(clean.contactPhone, undefined);
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
