const test = require("node:test");
const assert = require("node:assert");
const { collect } = require("./package-ext.js");

test("collect: боковая панель, service worker и их ассеты в пакете, popup.html нет", () => {
  const { files } = collect();
  for (const f of ["sidepanel.html", "sidepanel.css", "sidepanel.js", "background.js", "popup.js", "api.js"]) {
    assert.ok(files.includes(f), "нет в пакете: " + f);
  }
  assert.ok(!files.includes("popup.html"), "popup.html больше не существует");
});
