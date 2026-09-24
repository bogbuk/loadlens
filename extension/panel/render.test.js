const test = require("node:test");
const assert = require("node:assert");
const LLPANEL = require("./render.js");

const header = (over = {}) => ({
  loadsCount: 3, equipFilter: null, start: "DALLAS_TX", diesel: "3.90", cpm: 1.8,
  autoRefresh: { on: false, cloud: false }, sseLive: false, sort: { field: "", dir: "desc" },
  sortFields: [{ field: "rate", label: "Rate" }], drivers: [], activeDriverId: null, ...over,
});
const snap = (over = {}) => ({ board: "dat", hintsOff: false, header: header(), chains: [], deals: [], detail: null, ...over });
const UI = { expandedSig: null, notice: "" };

test("isBoardUrl: DAT/Truckstop да, похожие домены нет", () => {
  assert.strictEqual(LLPANEL.isBoardUrl("https://one.dat.com/search-loads"), true);
  assert.strictEqual(LLPANEL.isBoardUrl("https://main.truckstop.com/app/search"), true);
  assert.strictEqual(LLPANEL.isBoardUrl("https://dat.com.evil.io/"), false);
  assert.strictEqual(LLPANEL.isBoardUrl("https://notdat.com/"), false);
  assert.strictEqual(LLPANEL.isBoardUrl(undefined), false);
});

test("loadsView: шапка — водители, сортировка, авто-пилот, hints-кнопка", () => {
  const html = LLPANEL.loadsView(snap({
    header: header({ drivers: [{ id: "7", label: "Bob" }, { id: "8", label: "Ann" }], activeDriverId: "8",
      sort: { field: "rate", dir: "asc" }, autoRefresh: { on: true, cloud: false }, sseLive: true }),
  }), UI);
  assert.match(html, /<option value="8" selected>Ann<\/option>/);
  assert.match(html, /<option value="rate" selected>Rate<\/option>/);
  assert.match(html, /data-cmd="setSortDir" data-dir="desc"/);
  assert.match(html, /id="ll-ar" checked/);
  assert.match(html, /● live/);
  assert.match(html, /data-cmd="setHintsOff" data-on="1"/);
  assert.match(html, /Chains appear once/);
});

test("loadsView: облако — чекбокс авто-пилота заблокирован", () => {
  const html = LLPANEL.loadsView(snap({ header: header({ autoRefresh: { on: true, cloud: true } }) }), UI);
  assert.match(html, /id="ll-ar" checked disabled/);
});

test("цепочка: плечи только у раскрытой, live-плечо несёт data-result", () => {
  const chains = [{ sig: "A>B|2|10", hos: "green", path: "A → B", meta: "m", legs: [
    { kind: "live", resultId: "x+r1", idx: "leg 1 · V", route: "A → B", nbMi: 0, eco: "e", chips: [{ text: "Book Now", cls: "book" }] },
    { kind: "forecast", route: "B → C", nbMi: 40, fresh: "seen today", eco: "f" },
  ] }];
  const closed = LLPANEL.loadsView(snap({ chains }), UI);
  assert.doesNotMatch(closed, /leg-live/);
  const open = LLPANEL.loadsView(snap({ chains }), { ...UI, expandedSig: "A>B|2|10" });
  assert.match(open, /class="leg leg-live" data-cmd="scrollToRow" data-result="x\+r1"/);
  assert.match(open, /↪ \+40mi nearby/);
  assert.match(open, /<span class="lchip book">Book Now<\/span>/);
});

test("экранирование: враждебные строки из DAT не становятся разметкой", () => {
  const evil = '<img src=x onerror=alert(1)>';
  const html = LLPANEL.loadsView(snap({
    deals: [{ loadId: '"><b>', lane: evil, age: null, rpm: "2.00" }],
    header: header({ drivers: [{ id: '"x', label: evil }] }),
  }), UI);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /data-load="&quot;&gt;&lt;b&gt;"/);
});

test("деталь вместо списка: Back, строки, ссылки, отзыв о брокере", () => {
  const detail = {
    loadId: "L1", title: "A → B · V",
    rows: [{ k: "Rate", v: "$2,400" }, { k: "Phone", v: "555-1", href: "tel:555-1" }],
    flags: ["Rate far above market"], comments: "60ft <long>",
    fleet: { title: "Fits drivers (1/1)", rows: [{ ok: true, text: "✓ Bob" }] },
    actions: { book: null, mail: { url: "https://mail.google.com/x?a=1&b=2", primary: true }, call: { href: "tel:555-1", primary: false }, copyEmail: "s", copy: "c", brokerMc: "123" },
  };
  const html = LLPANEL.loadsView(snap({ detail }), UI);
  assert.match(html, /data-cmd="closeDetail"/);
  assert.doesNotMatch(html, /Get-out chains|Chains appear/);
  assert.match(html, /<a href="tel:555-1">555-1<\/a>/);
  assert.match(html, /href="https:\/\/mail\.google\.com\/x\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">✉️ Email broker/);
  assert.doesNotMatch(html, /Book Now ↗|Open ↗/);
  assert.match(html, /60ft &lt;long&gt;/);
  assert.match(html, /data-cmd="reportBroker" data-mc="123" data-outcome="double_brokered"/);
  assert.match(html, /data-cmd="copy" data-what="email"/);
});

test("notice и пустые состояния", () => {
  assert.match(LLPANEL.loadsView(snap(), { ...UI, notice: "No loads to export." }), /class="notice">No loads to export\./);
  assert.match(LLPANEL.empty("not-board"), /Open a DAT One or Truckstop search tab/);
  assert.match(LLPANEL.empty("no-script"), /Reload the DAT tab/);
  assert.match(LLPANEL.empty("connecting"), /Connecting/);
});
