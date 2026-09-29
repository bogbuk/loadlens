const test = require("node:test");
const assert = require("node:assert");
const LLCONTACT = require("./contact.js");

const parse = (url) => {
  const [addr, qs] = url.replace(/^mailto:/, "").split("?");
  const p = new URLSearchParams(qs);
  return { addr, subject: p.get("subject"), body: p.get("body") };
};

test("mailto pro: адрес, тема с email аккаунта, тело с аккаунтом", () => {
  const m = parse(LLCONTACT.mailto("pro", "a+b@x.com"));
  assert.strictEqual(m.addr, LLCONTACT.EMAIL);
  assert.strictEqual(m.subject, "LoadLens Pro request — a+b@x.com");
  assert.match(m.body, /LoadLens account: a\+b@x\.com/);
});

test("mailto без аккаунта: тема без хвоста, тело подсказывает", () => {
  const m = parse(LLCONTACT.mailto("pro"));
  assert.strictEqual(m.subject, "LoadLens Pro request");
  assert.match(m.body, /not signed up yet/);
});

test("mailto: неизвестная тема → question; спецсимволы экранированы", () => {
  const url = LLCONTACT.mailto("zzz", "a&b@x.com");
  assert.doesNotMatch(url.split("?")[1], /&b@/);
  assert.strictEqual(parse(url).subject, "LoadLens question — a&b@x.com");
});
