const test = require("node:test");
const assert = require("node:assert");
const LLTAB = require("./tabstate.js");

// фейковый sessionStorage-подобный объект
function fakeSS(init) {
  const store = { ...(init || {}) };
  return { store, getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
}

test("getAutorefresh: '1' → true, иначе false", () => {
  assert.strictEqual(LLTAB.getAutorefresh(fakeSS({ ll_tab_autorefresh: "1" })), true);
  assert.strictEqual(LLTAB.getAutorefresh(fakeSS({ ll_tab_autorefresh: "0" })), false);
  assert.strictEqual(LLTAB.getAutorefresh(fakeSS()), false);
});

test("setAutorefresh: пишет '1'/'0'", () => {
  const ss = fakeSS();
  LLTAB.setAutorefresh(ss, true);
  assert.strictEqual(ss.store.ll_tab_autorefresh, "1");
  LLTAB.setAutorefresh(ss, false);
  assert.strictEqual(ss.store.ll_tab_autorefresh, "0");
});

test("getHintsOff: '1' → true, дефолт false", () => {
  assert.strictEqual(LLTAB.getHintsOff(fakeSS({ ll_tab_hints_off: "1" })), true);
  assert.strictEqual(LLTAB.getHintsOff(fakeSS()), false);
});

test("setHintsOff: пишет '1'/'0'", () => {
  const ss = fakeSS();
  LLTAB.setHintsOff(ss, true);
  assert.strictEqual(ss.store.ll_tab_hints_off, "1");
  LLTAB.setHintsOff(ss, false);
  assert.strictEqual(ss.store.ll_tab_hints_off, "0");
});

test("толерантность: null storage и бросающий getItem → дефолт false", () => {
  assert.strictEqual(LLTAB.getAutorefresh(null), false);
  assert.strictEqual(LLTAB.getHintsOff({ getItem: () => { throw new Error("blocked"); } }), false);
});
