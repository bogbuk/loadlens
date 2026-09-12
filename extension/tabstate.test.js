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

// ---- глобальный тумблер (попап) + per-tab override (панель) ----
test("resolveAutorefresh: без override — берёт глобальный флаг", () => {
  assert.strictEqual(LLTAB.resolveAutorefresh(fakeSS(), true), true);
  assert.strictEqual(LLTAB.resolveAutorefresh(fakeSS(), false), false);
  assert.strictEqual(LLTAB.resolveAutorefresh(fakeSS(), undefined), false);
  assert.strictEqual(LLTAB.resolveAutorefresh(null, true), true); // нет sessionStorage → глобальный
});

test("resolveAutorefresh: per-tab override перекрывает глобальный в обе стороны", () => {
  assert.strictEqual(LLTAB.resolveAutorefresh(fakeSS({ ll_tab_autorefresh: "0" }), true), false);
  assert.strictEqual(LLTAB.resolveAutorefresh(fakeSS({ ll_tab_autorefresh: "1" }), false), true);
});

test("clearAutorefresh: снимает override → снова действует глобальный", () => {
  const ss = fakeSS({ ll_tab_autorefresh: "0" });
  ss.removeItem = (k) => { delete ss.store[k]; };
  LLTAB.clearAutorefresh(ss);
  assert.strictEqual(LLTAB.resolveAutorefresh(ss, true), true);
  assert.doesNotThrow(() => LLTAB.clearAutorefresh(null));
});
