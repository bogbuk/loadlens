const test = require("node:test");
const assert = require("node:assert");
const LLVIS = require("./visibility.js");

// state: { hintsOff, hideBadges, hidePanel, panelCollapsed } — все флаги по умолчанию false
const S = (over) => ({ hintsOff: false, hideBadges: false, hidePanel: false, panelCollapsed: false, ...over });

test("badgesVisible: по умолчанию видны", () => {
  assert.strictEqual(LLVIS.badgesVisible(S()), true);
});
test("badgesVisible: hintsOff (per-tab) скрывает", () => {
  assert.strictEqual(LLVIS.badgesVisible(S({ hintsOff: true })), false);
});
test("badgesVisible: hideBadges (глобально) скрывает", () => {
  assert.strictEqual(LLVIS.badgesVisible(S({ hideBadges: true })), false);
});
test("badgesVisible: hidePanel не влияет на бейджи", () => {
  assert.strictEqual(LLVIS.badgesVisible(S({ hidePanel: true })), true);
});

test("panelVisible: по умолчанию видна", () => {
  assert.strictEqual(LLVIS.panelVisible(S()), true);
});
test("panelVisible: hintsOff скрывает", () => {
  assert.strictEqual(LLVIS.panelVisible(S({ hintsOff: true })), false);
});
test("panelVisible: hidePanel (глобально) скрывает", () => {
  assert.strictEqual(LLVIS.panelVisible(S({ hidePanel: true })), false);
});
test("panelVisible: panelCollapsed скрывает", () => {
  assert.strictEqual(LLVIS.panelVisible(S({ panelCollapsed: true })), false);
});
test("panelVisible: hideBadges не влияет на панель", () => {
  assert.strictEqual(LLVIS.panelVisible(S({ hideBadges: true })), true);
});

test("fabVisible: панель видна → FAB не нужен", () => {
  assert.strictEqual(LLVIS.fabVisible(S()), false);
});
test("fabVisible: свёрнута per-tab → показываем возврат", () => {
  assert.strictEqual(LLVIS.fabVisible(S({ panelCollapsed: true })), true);
});
test("fabVisible: hintsOff per-tab → показываем возврат", () => {
  assert.strictEqual(LLVIS.fabVisible(S({ hintsOff: true })), true);
});
test("fabVisible: скрыта глобальной настройкой → без FAB (управление в попапе)", () => {
  assert.strictEqual(LLVIS.fabVisible(S({ hidePanel: true })), false);
});
