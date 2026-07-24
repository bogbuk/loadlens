const test = require("node:test");
const assert = require("node:assert");
const LLMAIL = require("./email-template.js");

const LOAD = {
  originMarket: "CHICAGO_IL", destMarket: "ATLANTA_GA", equipment: "Vans",
  rate: 1850, rateBasis: "flat", loadedMiles: 700, deadheadMiles: 150,
  brokerName: "Acme Logistics", brokerMc: "123456",
  availability: { earliest: "07/25", latest: "07/26" },
};

test("fillTemplate подставляет поля груза, водителя и контр-оффер", () => {
  const tpl = "Hi {{brokerName}} (MC {{brokerMc}}), load {{origin}} → {{dest}} {{equipment}} " +
    "{{loadedMiles}}mi +{{deadheadMiles}}DH, pickup {{pickupDate}}, posted {{rate}} {{rateBasis}}.\n" +
    "{{counterOffer}}\n{{driverName}}";
  const out = LLMAIL.fillTemplate(tpl, LOAD, { name: "Mike" }, { counterOffer: "I can do $2,100." });
  assert.match(out, /Hi Acme Logistics \(MC 123456\)/);
  assert.match(out, /CHICAGO_IL → ATLANTA_GA Vans 700mi \+150DH/);
  assert.match(out, /pickup 07\/25/);
  assert.match(out, /posted \$1,850 flat/);
  assert.match(out, /I can do \$2,100\./);
  assert.match(out, /Mike/);
});

test("fillTemplate: строка, состоящая только из пустого плейсхолдера, выбрасывается целиком", () => {
  const tpl = "Hello\n{{counterOffer}}\nBye";
  const out = LLMAIL.fillTemplate(tpl, LOAD, null, { counterOffer: null });
  assert.strictEqual(out, "Hello\nBye");
});

test("fillTemplate: пустое поле внутри осмысленной строки даёт «—», а не undefined", () => {
  const out = LLMAIL.fillTemplate("MC {{brokerMc}}, {{equipment}}", { brokerMc: null }, null, {});
  assert.strictEqual(out, "MC —, —");
  assert.ok(!/undefined|null/.test(out));
});

test("fillTemplate: неизвестный плейсхолдер не оставляет сырых скобок", () => {
  const out = LLMAIL.fillTemplate("X {{nosuchfield}} Y", LOAD, null, {});
  assert.ok(!/\{\{/.test(out));
  assert.strictEqual(out, "X — Y");
});

test("subjectFor описывает lane и прицеп", () => {
  assert.strictEqual(LLMAIL.subjectFor(LOAD), "Load inquiry: CHICAGO_IL → ATLANTA_GA (Vans)");
});

test("subjectFor терпит отсутствующие поля", () => {
  const s = LLMAIL.subjectFor({ originMarket: "CHICAGO_IL" });
  assert.ok(!/undefined|null/.test(s));
  assert.match(s, /CHICAGO_IL/);
});

test("gmailComposeUrl кодирует адрес, тему и тело", () => {
  const url = LLMAIL.gmailComposeUrl("ops@acme.com", "Load inquiry: A → B", "Line 1\nLine 2 & more");
  assert.ok(url.startsWith("https://mail.google.com/mail/?view=cm&fs=1&"));
  assert.match(url, /to=ops%40acme\.com/);
  assert.match(url, /su=Load%20inquiry%3A%20A%20%E2%86%92%20B/);
  assert.match(url, /body=Line%201%0ALine%202%20%26%20more/);
});

test("DEFAULT_TEMPLATE заполняется без остатков плейсхолдеров и «undefined»", () => {
  const out = LLMAIL.fillTemplate(LLMAIL.DEFAULT_TEMPLATE, LOAD, { name: "Mike" }, { counterOffer: "I can do $2,100." });
  assert.ok(!/\{\{/.test(out), "не должно остаться плейсхолдеров");
  assert.ok(!/undefined|null/.test(out));
  assert.match(out, /Acme Logistics/);
});

test("fillTemplate: без имени брокера приветствие остаётся человеческим, без «—»", () => {
  const out = LLMAIL.fillTemplate("Hi {{brokerName}},", { brokerName: null }, null, {});
  assert.strictEqual(out, "Hi there,");
});

test("fillTemplate: нулевые/отсутствующие груженые мили не печатаются как «0 mi»", () => {
  const out = LLMAIL.fillTemplate("{{loadedMiles}} mi", { loadedMiles: 0 }, null, {});
  assert.strictEqual(out, "— mi");
});

test("fillTemplate: нулевой deadhead — валидное значение и печатается как 0", () => {
  const out = LLMAIL.fillTemplate("+{{deadheadMiles}} DH", { deadheadMiles: 0 }, null, {});
  assert.strictEqual(out, "+0 DH");
});
