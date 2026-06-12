const test = require("node:test");
const assert = require("node:assert");
const PLCSV = require("./csv.js");

test("BOM + заголовок + строки через ;", () => {
  const csv = PLCSV.buildCsv(
    [{ listingId: "1", title: "Audi Q5", groupKey: "Audi Q5|2020", metric: 29450, unit: "EUR", attrs: { year: 2020 } }],
    ["year"],
  );
  assert.ok(csv.startsWith("﻿"));
  const lines = csv.slice(1).split("\r\n");
  assert.strictEqual(lines[0], "listing_id;title;group_key;metric_eur;unit;year");
  assert.strictEqual(lines[1], "1;Audi Q5;Audi Q5|2020;29450;EUR;2020");
});

test("экранирование ; кавычек и перевода строки (RFC 4180)", () => {
  const csv = PLCSV.buildCsv(
    [{ listingId: "2", title: 'BMW; "X5"\nдвухтопливный', groupKey: "BMW X5", metric: 1, unit: "EUR", attrs: {} }],
    [],
  );
  const line = csv.slice(1).split("\r\n")[1];
  assert.strictEqual(line, '2;"BMW; ""X5""\nдвухтопливный";BMW X5;1;EUR');
});

test("formula injection: ячейка с =,+,-,@ нейтрализуется ведущим '", () => {
  const csv = PLCSV.buildCsv(
    [{ listingId: "4", title: "=cmd|'/c calc'!A1", groupKey: "+1", metric: "-5", unit: "@x", attrs: {} }],
    [],
  );
  const line = csv.slice(1).split("\r\n")[1];
  // нет ; внутри -> без кавычек, только ведущий ' нейтрализует формулу
  assert.strictEqual(line, `4;'=cmd|'/c calc'!A1;'+1;'-5;'@x`);
});

test("пустые attrs -> пустая ячейка", () => {
  const csv = PLCSV.buildCsv(
    [{ listingId: "3", title: "T", groupKey: "G", metric: 5, unit: "EUR", attrs: {} }],
    ["year", "mileage"],
  );
  assert.strictEqual(csv.slice(1).split("\r\n")[1], "3;T;G;5;EUR;;");
});
