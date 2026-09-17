/* Публикация расширения в Chrome Web Store через официальный API.
   Дашборд CWS автоматизировать нельзя: Chrome запрещает расширениям скриптовать домен магазина
   («The extensions gallery cannot be scripted»), поэтому браузерного пути нет ни у кого. API — есть.

   Разовая настройка (только владелец аккаунта, см. docs/chrome-web-store-publishing.md):
     CWS_EXTENSION_ID, CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN
   Читаются из окружения или из .local_dev.env в корне (файл в .gitignore — секреты не коммитим).

   Запуск:
     node scripts/publish-ext.js --auth-url          # ссылка согласия Google (открывает владелец)
     node scripts/publish-ext.js --exchange <code>   # код из адресной строки → CWS_REFRESH_TOKEN
     node scripts/publish-ext.js --status     # что сейчас в магазине и в черновике
     node scripts/publish-ext.js              # залить zip в ЧЕРНОВИК (на ревью не отправляет)
     node scripts/publish-ext.js --publish    # залить и отправить на ревью
*/
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".local_dev.env");
const CREDS = ["CWS_EXTENSION_ID", "CWS_CLIENT_ID", "CWS_CLIENT_SECRET", "CWS_REFRESH_TOKEN"];

// ---- чистые хелперы (покрыты тестами) ----

// KEY=VALUE построчно; # — комментарий, кавычки вокруг значения снимаются.
function parseEnvFile(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || /^\s*#/.test(line)) continue;
    out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

function parseArgs(argv) {
  const a = new Set(argv);
  const i = argv.indexOf("--exchange");
  return {
    status: a.has("--status"),
    publish: a.has("--publish"),
    authUrl: a.has("--auth-url"),
    code: i >= 0 ? argv[i + 1] || "" : null,
  };
}

// Ссылка согласия Google: её открывает ВЛАДЕЛЕЦ аккаунта (логин за него никто сделать не может).
// redirect_uri=http://localhost страница не откроется — код забирается из адресной строки (?code=...).
function authUrl(clientId) {
  const q = new URLSearchParams({
    response_type: "code",
    scope: "https://www.googleapis.com/auth/chromewebstore",
    client_id: clientId,
    redirect_uri: "http://localhost",
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/auth?${q}`;
}

// Чего не хватает для работы с API (пустая строка = не задано).
function missingCreds(env) {
  return CREDS.filter((k) => !String((env || {})[k] || "").trim());
}

// Пакет собирается под версию манифеста — расхождение значит «забыли npm run package:ext».
function packageFor(version, exists) {
  const rel = `dist/loadlens-extension-${version}.zip`;
  if (!exists(path.join(ROOT, rel))) {
    throw new Error(`нет ${rel} — сначала npm run package:ext (манифест: ${version})`);
  }
  return rel;
}

// ---- сеть ----

async function accessToken(env) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.CWS_CLIENT_ID,
      client_secret: env.CWS_CLIENT_SECRET,
      refresh_token: env.CWS_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`OAuth ${res.status}: ${body.error_description || body.error || "нет access_token"}`);
  }
  return body.access_token;
}

async function api(token, url, init) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "x-goog-api-version": "2", ...(init && init.headers) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${url} → ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

const ITEM = (id) => `https://www.googleapis.com/chromewebstore/v1.1/items/${id}`;

async function main() {
  const { status, publish, authUrl: wantUrl, code } = parseArgs(process.argv.slice(2));
  const env = { ...(fs.existsSync(ENV_FILE) ? parseEnvFile(fs.readFileSync(ENV_FILE, "utf8")) : {}), ...process.env };

  // Шаги разовой авторизации — до проверки полного набора доступов (их ещё нет).
  if (wantUrl || code != null) {
    for (const k of ["CWS_CLIENT_ID", "CWS_CLIENT_SECRET"]) {
      if (!env[k]) throw new Error(`нет ${k} в .local_dev.env — сперва OAuth-клиент «Desktop app»`);
    }
    if (wantUrl) { console.log(authUrl(env.CWS_CLIENT_ID)); return; }
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.CWS_CLIENT_ID, client_secret: env.CWS_CLIENT_SECRET,
        code, grant_type: "authorization_code", redirect_uri: "http://localhost",
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.refresh_token) throw new Error(`обмен кода не удался: ${JSON.stringify(body)}`);
    console.log(`CWS_REFRESH_TOKEN=${body.refresh_token}`);
    console.log("^ строку целиком дописать в .local_dev.env (он в .gitignore)");
    return;
  }

  const missing = missingCreds(env);
  if (missing.length) {
    console.error(
      `publish:ext — нет доступов: ${missing.join(", ")}.\n` +
      `Разовая настройка описана в docs/chrome-web-store-publishing.md; значения класть в .local_dev.env (он в .gitignore).`,
    );
    process.exit(2);
  }

  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "extension/manifest.json"), "utf8")).version;
  const token = await accessToken(env);
  const id = env.CWS_EXTENSION_ID;

  if (status) {
    const it = await api(token, `${ITEM(id)}?projection=DRAFT`, { method: "GET" });
    console.log(`item ${id}: черновик ${it.crxVersion || "?"} · статус ${(it.status || []).join(", ") || "?"}`);
    return;
  }

  const rel = packageFor(version, fs.existsSync);
  const zip = fs.readFileSync(path.join(ROOT, rel));
  console.log(`publish:ext — заливаю ${rel} (${(zip.length / 1024).toFixed(1)} КБ) в item ${id}`);

  const up = await api(token, `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${id}?uploadType=media`, {
    method: "PUT",
    body: zip,
  });
  if (up.uploadState !== "SUCCESS") {
    throw new Error(`загрузка не принята: ${up.uploadState} ${JSON.stringify(up.itemError || [])}`);
  }
  console.log(`  загружено, черновик теперь ${version}`);

  if (!publish) {
    console.log("  на ревью НЕ отправлено (нужен флаг --publish)");
    return;
  }
  const pub = await api(token, `${ITEM(id)}/publish?publishTarget=default`, { method: "POST" });
  console.log(`  отправлено на ревью: ${(pub.status || []).join(", ") || "?"}`);
  if (pub.statusDetail && pub.statusDetail.length) console.log(`  ${pub.statusDetail.join("; ")}`);
}

if (require.main === module) {
  main().catch((e) => { console.error(`publish:ext — ${e.message}`); process.exit(1); });
}

module.exports = { parseEnvFile, parseArgs, missingCreds, packageFor, authUrl, CREDS };
