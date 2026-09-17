const test = require("node:test");
const assert = require("node:assert");
const P = require("./publish-ext.js");

test("parseEnvFile: KEY=VALUE, кавычки снимаются, комментарии и мусор игнорируются", () => {
  const env = P.parseEnvFile([
    "# комментарий",
    "CWS_CLIENT_ID=123.apps.googleusercontent.com",
    'CWS_CLIENT_SECRET="sec ret"',
    "export CWS_REFRESH_TOKEN='1//abc'",
    "мусор без знака равно",
    "",
  ].join("\n"));
  assert.deepStrictEqual(env, {
    CWS_CLIENT_ID: "123.apps.googleusercontent.com",
    CWS_CLIENT_SECRET: "sec ret",
    CWS_REFRESH_TOKEN: "1//abc",
  });
});

test("parseArgs: флаги --status / --publish", () => {
  assert.deepStrictEqual(P.parseArgs([]), { status: false, publish: false, authUrl: false, code: null });
  assert.strictEqual(P.parseArgs(["--publish"]).publish, true);
  assert.strictEqual(P.parseArgs(["--publish"]).status, false);
  assert.strictEqual(P.parseArgs(["--status"]).status, true);
  assert.strictEqual(P.parseArgs(["--status"]).publish, false);   // залив без отправки на ревью — дефолт
});

test("missingCreds: пустая строка считается не заданной", () => {
  assert.deepStrictEqual(P.missingCreds({}), P.CREDS);
  const full = Object.fromEntries(P.CREDS.map((k) => [k, "x"]));
  assert.deepStrictEqual(P.missingCreds(full), []);
  assert.deepStrictEqual(P.missingCreds({ ...full, CWS_REFRESH_TOKEN: "  " }), ["CWS_REFRESH_TOKEN"]);
});

test("packageFor: путь по версии манифеста; без собранного zip — внятная ошибка", () => {
  assert.strictEqual(P.packageFor("0.8.0", () => true), "dist/loadlens-extension-0.8.0.zip");
  assert.throws(() => P.packageFor("0.8.0", () => false), /npm run package:ext/);
});

test("parseArgs: --auth-url и --exchange <code>", () => {
  assert.strictEqual(P.parseArgs(["--auth-url"]).authUrl, true);
  assert.strictEqual(P.parseArgs(["--exchange", "4/abc"]).code, "4/abc");
  assert.strictEqual(P.parseArgs(["--exchange"]).code, "");      // флаг без кода — не молча ok
  assert.strictEqual(P.parseArgs([]).code, null);
});

test("authUrl: scope магазина, offline-доступ и принудительное согласие (иначе не придёт refresh_token)", () => {
  const u = new URL(P.authUrl("cid.apps.googleusercontent.com"));
  assert.strictEqual(u.searchParams.get("client_id"), "cid.apps.googleusercontent.com");
  assert.strictEqual(u.searchParams.get("scope"), "https://www.googleapis.com/auth/chromewebstore");
  assert.strictEqual(u.searchParams.get("access_type"), "offline");
  assert.strictEqual(u.searchParams.get("prompt"), "consent");
});
