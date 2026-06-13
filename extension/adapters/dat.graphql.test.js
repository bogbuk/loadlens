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
  assert.strictEqual(loads.length, 2);
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

test("isFindLoadsResponse распознаёт ответ; мусор → []", () => {
  assert.strictEqual(DAT_GQL.isFindLoadsResponse(fixture), true);
  assert.strictEqual(DAT_GQL.isFindLoadsResponse({ data: {} }), false);
  assert.deepStrictEqual(DAT_GQL.parseFindLoads({ data: {} }), []);
});
