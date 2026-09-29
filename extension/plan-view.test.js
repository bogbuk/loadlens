const test = require("node:test");
const assert = require("node:assert");
const LLPLANVIEW = require("./plan-view.js");

const DAY = 86400000;
const NOW = 1790000000000;

test("постоянный Pro: бейдж PRO, без заметки", () => {
  assert.deepStrictEqual(LLPLANVIEW.view({ plan: "pro", trialEndsAt: null }, NOW),
    { badge: "PRO", pro: true, note: null, daysLeft: null });
});

test("активный триал: PRO TRIAL и дни с округлением вверх", () => {
  assert.deepStrictEqual(LLPLANVIEW.view({ plan: "pro", trialEndsAt: NOW + 8 * DAY + 1 }, NOW),
    { badge: "PRO TRIAL", pro: true, note: "trial", daysLeft: 9 });
  assert.strictEqual(LLPLANVIEW.view({ plan: "pro", trialEndsAt: NOW + 1000 }, NOW).daysLeft, 1);
});

test("триал закончился: FREE и заметка ended", () => {
  assert.deepStrictEqual(LLPLANVIEW.view({ plan: "free", trialEndsAt: NOW - DAY }, NOW),
    { badge: "FREE", pro: false, note: "ended", daysLeft: null });
});

test("Free без триала: FREE и upsell", () => {
  assert.deepStrictEqual(LLPLANVIEW.view({ plan: "free", trialEndsAt: null }, NOW),
    { badge: "FREE", pro: false, note: "upsell", daysLeft: null });
  assert.strictEqual(LLPLANVIEW.view({ plan: "free" }, NOW).note, "upsell");
});

test("кэш говорит pro, а триал уже истёк по часам — показываем FREE/ended", () => {
  assert.strictEqual(LLPLANVIEW.view({ plan: "pro", trialEndsAt: NOW - 1 }, NOW).note, "ended");
});
