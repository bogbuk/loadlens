const test = require("node:test");
const assert = require("node:assert");
const LLSSE = require("./sse-frames.js");

test("SSE: полный кадр id+event+data → одно событие", () => {
  const p = LLSSE.createParser();
  const ev = p.push("id:abc:1\nevent:LOAD_MATCH_CREATED\ndata:{\"a\":1}\n\n");
  assert.deepStrictEqual(ev, [{ id: "abc:1", event: "LOAD_MATCH_CREATED", data: "{\"a\":1}" }]);
});

test("SSE: комментарии keep-alive и retry не дают событий", () => {
  const p = LLSSE.createParser();
  assert.deepStrictEqual(p.push(":Keep-Alive\n\n"), []);
  assert.deepStrictEqual(p.push("retry:3000\n\n"), []);
});

test("SSE: кадр, разрезанный между чанками, склеивается", () => {
  const p = LLSSE.createParser();
  assert.deepStrictEqual(p.push("event:LOAD_MATCH_UPDATED\ndata:{\"post"), []);
  const ev = p.push("ingId\":\"P1\"}\n\n:Keep-Alive\n\n");
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0].event, "LOAD_MATCH_UPDATED");
  assert.strictEqual(ev[0].data, "{\"postingId\":\"P1\"}");
});

test("SSE: многострочный data склеивается через \\n, пробел после двоеточия срезается, CRLF терпим", () => {
  const p = LLSSE.createParser();
  const ev = p.push("event: X\r\ndata: line1\r\ndata: line2\r\n\r\n");
  assert.deepStrictEqual(ev, [{ id: null, event: "X", data: "line1\nline2" }]);
});

test("SSE: кадр без event → event 'message'; кадр без data пропускается", () => {
  const p = LLSSE.createParser();
  assert.deepStrictEqual(p.push("data:x\n\n"), [{ id: null, event: "message", data: "x" }]);
  assert.deepStrictEqual(p.push("event:only\n\n"), []);
});
