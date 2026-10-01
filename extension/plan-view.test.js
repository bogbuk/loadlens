const test = require("node:test");
const assert = require("node:assert");
const LLPLANVIEW = require("./plan-view.js");

const DAY = 86400000;
const NOW = 1790000000000;

test("постоянный Pro: бейдж PRO, без заметки", () => {
  assert.deepStrictEqual(LLPLANVIEW.view({ plan: "pro", trialEndsAt: null }, NOW),
    { badge: "PRO", pro: true, note: null, daysLeft: null, action: "contact", subLine: null });
});

test("активный триал: PRO TRIAL и дни с округлением вверх", () => {
  assert.deepStrictEqual(LLPLANVIEW.view({ plan: "pro", trialEndsAt: NOW + 8 * DAY + 1 }, NOW),
    { badge: "PRO TRIAL", pro: true, note: "trial", daysLeft: 9, action: "contact", subLine: null });
  assert.strictEqual(LLPLANVIEW.view({ plan: "pro", trialEndsAt: NOW + 1000 }, NOW).daysLeft, 1);
});

test("триал закончился: FREE и заметка ended", () => {
  assert.deepStrictEqual(LLPLANVIEW.view({ plan: "free", trialEndsAt: NOW - DAY }, NOW),
    { badge: "FREE", pro: false, note: "ended", daysLeft: null, action: "contact", subLine: null });
});

test("Free без триала: FREE и upsell", () => {
  assert.deepStrictEqual(LLPLANVIEW.view({ plan: "free", trialEndsAt: null }, NOW),
    { badge: "FREE", pro: false, note: "upsell", daysLeft: null, action: "contact", subLine: null });
  assert.strictEqual(LLPLANVIEW.view({ plan: "free" }, NOW).note, "upsell");
});

test("кэш говорит pro, а триал уже истёк по часам — показываем FREE/ended", () => {
  assert.strictEqual(LLPLANVIEW.view({ plan: "pro", trialEndsAt: NOW - 1 }, NOW).note, "ended");
});

test("billing выключен — всегда contact (старое поведение)", () => {
  for (const u of [{ plan: "free" }, { plan: "pro", trialEndsAt: NOW + DAY }, { plan: "free", trialEndsAt: NOW - DAY }])
    assert.strictEqual(LLPLANVIEW.view(u, NOW).action, "contact");
});

test("billing включён: Free/триал/конец триала — upgrade", () => {
  for (const u of [{ plan: "free" }, { plan: "pro", trialEndsAt: NOW + DAY }, { plan: "free", trialEndsAt: NOW - DAY }])
    assert.strictEqual(LLPLANVIEW.view({ ...u, billing: true }, NOW).action, "upgrade");
});

test("подписчик — manage и строка продления/окончания", () => {
  const renews = Date.UTC(2026, 10, 1);
  const v = LLPLANVIEW.view({ plan: "pro", billing: true, subscription: { status: "active", renewsAt: renews, endsAt: null } }, NOW);
  assert.strictEqual(v.action, "manage");
  assert.match(v.subLine, /^Renews on /);
  const e = LLPLANVIEW.view({ plan: "pro", billing: true, subscription: { status: "active", renewsAt: null, endsAt: renews } }, NOW);
  assert.match(e.subLine, /^Ends on /);
  const pd = LLPLANVIEW.view({ plan: "pro", billing: true, subscription: { status: "past_due", renewsAt: null, endsAt: null } }, NOW);
  assert.strictEqual(pd.subLine, "Payment failed — update your card");
});

test("постоянный Pro без подписки при billing — без кнопок", () => {
  assert.strictEqual(LLPLANVIEW.view({ plan: "pro", billing: true, subscription: null }, NOW).action, "contact");
});

test("подписка canceled — снова upgrade", () => {
  assert.strictEqual(LLPLANVIEW.view({ plan: "free", billing: true, subscription: { status: "canceled", renewsAt: null, endsAt: null } }, NOW).action, "upgrade");
});
