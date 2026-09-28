const test = require("node:test");
const assert = require("node:assert");
const LLVIS = require("./visibility.js");

// state: { hintsOff, hideBadges, hideFab, panelOpen } — все флаги по умолчанию false
const S = (over) => ({ hintsOff: false, hideBadges: false, hideFab: false, panelOpen: false, ...over });

test("badgesVisible: по умолчанию видны", () => { assert.strictEqual(LLVIS.badgesVisible(S()), true); });
test("badgesVisible: hintsOff (per-tab) скрывает", () => { assert.strictEqual(LLVIS.badgesVisible(S({ hintsOff: true })), false); });
test("badgesVisible: hideBadges (глобально) скрывает", () => { assert.strictEqual(LLVIS.badgesVisible(S({ hideBadges: true })), false); });
test("badgesVisible: открытая панель не влияет", () => { assert.strictEqual(LLVIS.badgesVisible(S({ panelOpen: true })), true); });

test("fabVisible: панель закрыта → FAB как вход в неё", () => { assert.strictEqual(LLVIS.fabVisible(S()), true); });
test("fabVisible: панель подключена к вкладке → FAB не нужен", () => { assert.strictEqual(LLVIS.fabVisible(S({ panelOpen: true })), false); });
test("fabVisible: hintsOff per-tab → без FAB (вернуть — из панели)", () => { assert.strictEqual(LLVIS.fabVisible(S({ hintsOff: true })), false); });
test("fabVisible: hideBadges не прячет FAB", () => { assert.strictEqual(LLVIS.fabVisible(S({ hideBadges: true })), true); });
test("fabVisible: hideFab (ll_hide_panel, глобально) прячет FAB", () => { assert.strictEqual(LLVIS.fabVisible(S({ hideFab: true })), false); });
test("badgesVisible: hideFab бейджи не прячет", () => { assert.strictEqual(LLVIS.badgesVisible(S({ hideFab: true })), true); });
