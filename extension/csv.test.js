const test = require("node:test");
const assert = require("node:assert");
const LLCSV = require("./csv.js");

const LOAD = {
  board: "dat", loadId: "POST-1", originMarket: "CHICAGO_IL", destMarket: "ATLANTA_GA",
  equipment: "F", rate: 1950, rateBasis: "FLAT", loadedMiles: 716, deadheadMiles: 22,
  brokerName: "Acme Freight", brokerMc: "MC-555000", creditScore: 92, daysToPay: 28,
  isFactorable: true, comments: "Tarp required",
};

test("BOM + заголовок + строка через ; ", () => {
  const csv = LLCSV.buildLoadsCsv([LOAD]);
  assert.ok(csv.startsWith("﻿"));
  const lines = csv.slice(1).split("\r\n");
  assert.strictEqual(lines[0], LLCSV.HEAD.join(";"));
  // true_rpm = 1950 / (716+22) = 2.64
  assert.ok(lines[1].includes("dat;POST-1;CHICAGO_IL;ATLANTA_GA;F;1950;FLAT;716;22;2.64;Acme Freight;MC-555000;92;28;yes;Tarp required"));
});

test("formula injection: ячейка с = нейтрализуется ведущим '", () => {
  const csv = LLCSV.buildLoadsCsv([{ ...LOAD, brokerName: "=cmd|'/c calc'!A1" }]);
  const line = csv.slice(1).split("\r\n")[1];
  assert.ok(line.includes(";'=cmd|'/c calc'!A1;"));
});

test("экранирование ; кавычек и переноса (RFC 4180)", () => {
  const csv = LLCSV.buildLoadsCsv([{ ...LOAD, comments: 'note; with "quote"\nи перенос' }]);
  const cell = LLCSV.cell('note; with "quote"\nи перенос');
  assert.strictEqual(cell, '"note; with ""quote""\nи перенос"');
});

test("пустые поля → пустые ячейки, rpm пуст без миль", () => {
  const csv = LLCSV.buildLoadsCsv([{ board: "dat", loadId: "X", originMarket: "A", destMarket: "B", equipment: "V" }]);
  const line = csv.slice(1).split("\r\n")[1];
  assert.strictEqual(line, "dat;X;A;B;V;;;;;;;;;;;");
});
