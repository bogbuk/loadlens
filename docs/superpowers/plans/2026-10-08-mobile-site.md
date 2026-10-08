# Mobile Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make loadlens.krait.studio useful on a phone: the HOS calculator becomes an installable, offline, self-remembering tool with its answer always visible, and every dead-end "Add to Chrome" button on a phone becomes "Send me the link" / "Get it in Telegram" (bot replies with the install link and reminds once).

**Architecture:** Static pages in `backend/public` stay the single source (EN markup + `landing/*.i18n.json` → RU/RO via `scripts/build-landing.js`). Phone detection is an inline `<head>` script that adds `is-mobile` to `<html>`; CSS swaps CTA blocks. Calculator logic that can be pure lives in `js/hos-mobile.js` (UMD, unit-tested with node:test); DOM glue stays in `hos-page.js` / new `hos-pwa.js`. A root `sw.js` caches only calculator pages and assets. Backend adds a `GET /telegram/install` redirect, a `/start install_<lang>` webhook branch, an `install_leads` table and an hourly reminder cron.

**Tech Stack:** Vanilla JS + CSS (no build step), node:test, Python Playwright (e2e), Pillow (icons), NestJS 10 + sequelize-typescript + @nestjs/schedule, Jest.

**Spec:** `docs/superpowers/specs/2026-10-08-mobile-site-design.md`

## Global Constraints

- Visual style unchanged: colors/fonts/cards/logo from `backend/public/css/site.css` tokens (`--green`, `--green-bg`, `--amber-bg`, `--red-bg`, `--card`, `--line`, `--shadow`).
- EN markup is the source; every new visible string has `data-i18n` and RU/RO values; after editing `index.html`, `hos-calculator/index.html` or `landing/*.json` run `npm run build:landing`. Never hand-edit `backend/public/{ru,ro}/…`.
- Desktop and crawlers see what they see today: the `data-cws` "Add to Chrome" anchors stay in HTML (only gain class `cta-desktop`).
- New texts do not mention DAT and do not advertise the autopilot.
- Mobile breakpoint for calculator bar: `max-width: 860px` (same as existing calculator grid). Consent compact layout: `max-width: 600px`.
- Phone = `/Android|iPhone|iPad|iPod/` in UA, or `/Macintosh/` in UA with `navigator.maxTouchPoints > 1`.
- Storage keys: `ll_hos_form` (form, JSON `{v:1,f:{…}}`), `ll_a2hs_seen` (`"1"`). Every storage access in try/catch.
- Metrika goals (only when `window.ym` is loaded): `share_link`, `tg_install`, `a2hs`; params `{ place, lang }`.
- Bot payloads: `install`, `install_en`, `install_ru`, `install_ro`. Reminder: once, 24h ≤ age < 7d, skip chats linked in `users.telegram_chat_id`, mark `reminded_at` even if send fails; delete leads older than 30 days.
- Git commits: no AI mention, no `Co-Authored-By` (user rule). Work in a worktree (`../dat.com-mobile`, branch `mobile-site`), merge to `main` ff-only (main moves under parallel sessions).

## Review Focus

1. **EN page language redirect wipes the `is-mobile` class** — the existing head script does `document.documentElement.className = "i18n-pending"`; a RU-browser phone would lose `is-mobile` until redirect. Expected: class survives. → Task 4 changes it to `classList.add` and the test asserts no `className =` assignment in page heads.
2. **Old/garbage `ll_hos_form` in storage** (manual edit, schema change, `"null"`, array). Expected: ignored, defaults shown, no exception. → Task 3 `decode` tests.
3. **Offline open of a calculator page never visited / SW install failed.** Expected: browser's normal offline error, not a broken SW response (`Response.error()`, no unhandled rejection). → Task 3 `routeFor` tests + e2e offline step in Task 9.
4. **`/start install_ru` collides with the link-token regex** (`install_ru` is 10 chars of `[A-Za-z0-9_-]`). Expected: install reply, NOT "This link has expired". → Task 7 webhook test.
5. **User cancels the native share sheet.** Expected: nothing else happens (no mailto fallback popping up). → Task 4 code checks `AbortError`; e2e can't cover, assertion on site.js source in Task 4 test.

---

### Task 0: Worktree

- [ ] **Step 1:** `cd /Users/bogdan/work/startup/dat.com && git fetch -q && git worktree add ../dat.com-mobile -b mobile-site main && cd ../dat.com-mobile && (cd backend && npm ci)`
- [ ] **Step 2:** `npm test` in `../dat.com-mobile` → all PASS (baseline). `cd backend && npx jest` → PASS.

All later paths are relative to `../dat.com-mobile`.

---

### Task 1: App icons 192/512/maskable

**Files:**
- Create: `scripts/make-icons.py`, `backend/public/icons/icon-192.png`, `backend/public/icons/icon-512.png`, `backend/public/icons/icon-maskable-512.png`

**Interfaces:** Produces `/icons/icon-192.png`, `/icons/icon-512.png`, `/icons/icon-maskable-512.png` (used by Task 2 manifest, Task 3 SW, Task 4 apple-touch-icon).

Geometry measured from the 128px `backend/public/icon.png`: green `#0E9E5A`, corner radius ≈28, white bars (x0..x1, y0..y1 inclusive) `(30,56)-(46,94)`, `(55,30)-(71,94)`, `(80,43)-(96,94)`.

- [ ] **Step 1: Write the script**

```python
#!/usr/bin/env python3
"""Иконки PWA HOS-калькулятора из геометрии логотипа (icon.png 128px): апскейл 128px даёт мыло.
Запуск: python3 -I scripts/make-icons.py (нужен Pillow). Результат коммитится."""
import os, sys
from PIL import Image, ImageDraw

GREEN = (14, 158, 90, 255)
BARS = [(30, 56, 46, 94), (55, 30, 71, 94), (80, 43, 96, 94)]  # на сетке 128, включительно
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend", "public", "icons")

def draw(size, maskable=False):
    s = size / 128
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if maskable:
        d.rectangle([0, 0, size - 1, size - 1], fill=GREEN)
        k, off = 0.8 * s, size * 0.1   # безопасная зона maskable — центральные 80%
    else:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=round(28 * s), fill=GREEN)
        k, off = s, 0
    for x0, y0, x1, y1 in BARS:
        d.rounded_rectangle([off + x0 * k, off + y0 * k, off + (x1 + 1) * k - 1, off + (y1 + 1) * k - 1],
                            radius=max(1, round(3 * k)), fill=(255, 255, 255, 255))
    return im

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    draw(192).save(os.path.join(OUT, "icon-192.png"))
    draw(512).save(os.path.join(OUT, "icon-512.png"))
    draw(512, maskable=True).save(os.path.join(OUT, "icon-maskable-512.png"))
    print("icons ->", os.path.relpath(OUT), file=sys.stderr)
```

- [ ] **Step 2:** Run `python3 -I scripts/make-icons.py`. Open `backend/public/icons/icon-512.png` and `backend/public/icon.png` side by side (Read tool) — same shape, sharp edges. If bars look off, adjust `BARS` only.
- [ ] **Step 3: Commit**

```bash
git add scripts/make-icons.py backend/public/icons
git commit -m "feat(site): иконки 192/512/maskable для установки HOS-калькулятора"
```

---

### Task 2: Per-language web manifests from build-landing

**Files:**
- Modify: `scripts/build-landing.js` (PAGES entry, new `manifest()`, `build()`)
- Modify: `landing/hos-calculator.i18n.json` (keys `meta.pwa.name`, `meta.pwa.short` in en/ru/ro)
- Modify: `backend/public/hos-calculator/index.html` `<head>` (manifest link, theme-color, apple-touch-icon)
- Test: `scripts/landing-i18n.test.js`

**Interfaces:**
- Consumes: icons from Task 1.
- Produces: `backend/public/{,ru/,ro/}hos-calculator/manifest.webmanifest` (generated); `PAGES[i].pwa === true` for the calculator.

Keys use the `meta.` prefix so the existing dictionary tests (`/^(js|meta)\./`) accept them unchanged.

- [ ] **Step 1: Write the failing test** (append to `scripts/landing-i18n.test.js`)

```js
test("калькулятор: манифест на каждом языке — имя языка, start_url и scope на свою версию, иконки", () => {
  for (const lang of Object.keys(LANGS)) {
    const rel = path.join(urlOf(lang, CALC).slice(1), "manifest.webmanifest");
    assert.ok(built[rel], `нет ${rel}`);
    const m = JSON.parse(built[rel]);
    const d = { ...CALC_I18N.en, ...CALC_I18N[lang] };
    assert.strictEqual(m.name, d["meta.pwa.name"]);
    assert.strictEqual(m.short_name, d["meta.pwa.short"]);
    assert.ok(m.short_name.length <= 12, "short_name обрезается на экране телефона");
    assert.strictEqual(m.start_url, urlOf(lang, CALC) + "?source=pwa");
    assert.strictEqual(m.scope, urlOf(lang, CALC));
    assert.strictEqual(m.display, "standalone");
    assert.deepStrictEqual(m.icons.map((i) => i.src), ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png"]);
    for (const i of m.icons) assert.ok(fs.existsSync(path.join(PUB, i.src)), `нет файла ${i.src}`);
  }
  const head = calcHtml.split("</head>")[0];
  assert.match(head, /<link rel="manifest" href="manifest\.webmanifest" \/>/);
  assert.match(head, /<meta name="theme-color" content="#0e9e5a" \/>/);
  assert.match(head, /<link rel="apple-touch-icon" href="\/icons\/icon-192\.png" \/>/);
});
```

- [ ] **Step 2:** `node --test scripts/landing-i18n.test.js` → FAIL (`нет hos-calculator/manifest.webmanifest`).
- [ ] **Step 3: Implement**

In `scripts/build-landing.js` change the calculator entry of `PAGES`:

```js
  { src: "hos-calculator/index.html", dict: "landing/hos-calculator.i18n.json", path: "/hos-calculator/", ld: "tool", pwa: true },
```

Add after `stringsBlock`:

```js
// Манифест PWA (только страницы с pwa: true): имя на языке страницы, запуск и scope — своя языковая версия.
function manifest(lang, pg, d) {
  return JSON.stringify({
    name: d["meta.pwa.name"], short_name: d["meta.pwa.short"], lang,
    start_url: urlOf(lang, pg) + "?source=pwa", scope: urlOf(lang, pg),
    display: "standalone", background_color: "#ffffff", theme_color: "#0e9e5a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }, null, 2) + "\n";
}
```

In `build()` replace the inner loop line with:

```js
    for (const lang of Object.keys(LANGS)) {
      const dir = urlOf(lang, pg).slice(1);
      files[path.join(dir, "index.html")] = page(src, lang, pg, dict);
      if (pg.pwa) files[path.join(dir, "manifest.webmanifest")] = manifest(lang, pg, { ...dict.en, ...(dict[lang] || {}) });
    }
```

In `landing/hos-calculator.i18n.json` add to `en`: `"meta.pwa.name": "HOS Calculator", "meta.pwa.short": "HOS Calc"`; `ru`: `"meta.pwa.name": "Калькулятор HOS", "meta.pwa.short": "HOS"`; `ro`: `"meta.pwa.name": "Calculator HOS", "meta.pwa.short": "Calcul HOS"`.

In `backend/public/hos-calculator/index.html` right after `<link rel="icon" href="/icon.png" />`:

```html
  <link rel="manifest" href="manifest.webmanifest" />
  <meta name="theme-color" content="#0e9e5a" />
  <link rel="apple-touch-icon" href="/icons/icon-192.png" />
```

- [ ] **Step 4:** `npm run build:landing && node --test scripts/landing-i18n.test.js` → PASS.
- [ ] **Step 5: Commit**

```bash
git add scripts/build-landing.js scripts/landing-i18n.test.js landing/hos-calculator.i18n.json backend/public/hos-calculator backend/public/ru/hos-calculator backend/public/ro/hos-calculator
git commit -m "feat(hos-calc): манифест PWA на каждом языке из build:landing"
```

---

### Task 3: Calculator core — pure helpers, result bar, remembered input, service worker, Add to Home Screen

**Files:**
- Create: `backend/public/js/hos-mobile.js`, `backend/public/js/hos-pwa.js`, `backend/public/sw.js`, `scripts/hos-mobile.test.js`
- Modify: `backend/public/js/hos-page.js` (save/restore, bar, reset), `backend/public/hos-calculator/index.html` (markup, styles, scripts), `landing/hos-calculator.i18n.json` (ru/ro for new markup keys), `scripts/landing-i18n.test.js` (script order assertion)

**Interfaces:**
- Produces (global `LLHOSM` in browser / `module.exports` in node):
  - `KEY: "ll_hos_form"`
  - `level(r: {driveNow:number}): "ok"|"warn"|"bad"` — `bad` if driveNow ≤ 0 or not a number, `warn` if < 60, else `ok`
  - `encode(fields: {id:string,type:string,value:string,checked:boolean}[]): string`
  - `decode(raw: unknown): Record<string,string|boolean> | null`
  - `iosHintDue(s: {isIOS:boolean,standalone:boolean,seen:boolean,computed:boolean}): boolean`
- Produces (`sw.js`, node export): `routeFor(url: string, origin: string): "page"|"asset"|"pass"`, `CALC_PAGES`, `ASSETS`, `CACHE`
- DOM ids added: `left-panel` (the "Time left" panel), `hos-bar`, `hos-bar-text`, `reset`, `a2hs`, `a2hs-ios`, `a2hs-x`.

- [ ] **Step 1: Write the failing tests** — `scripts/hos-mobile.test.js`

```js
/* Чистая логика мобильного HOS-калькулятора (js/hos-mobile.js) и маршрутизация service worker (sw.js). */
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const PUB = path.join(__dirname, "..", "backend", "public");
const M = require(path.join(PUB, "js", "hos-mobile.js"));
const SW = require(path.join(PUB, "sw.js"));

test("level: красный при 0 и мусоре, янтарный < 1 ч, зелёный от часа", () => {
  assert.strictEqual(M.level({ driveNow: 0 }), "bad");
  assert.strictEqual(M.level({ driveNow: -5 }), "bad");
  assert.strictEqual(M.level({}), "bad");
  assert.strictEqual(M.level(null), "bad");
  assert.strictEqual(M.level({ driveNow: 59 }), "warn");
  assert.strictEqual(M.level({ driveNow: 60 }), "ok");
  assert.strictEqual(M.level({ driveNow: 660 }), "ok");
});

test("encode/decode: поля по id, галки и радио — boolean, остальное — строка", () => {
  const raw = M.encode([
    { id: "driven-h", type: "number", value: "3", checked: false },
    { id: "split", type: "checkbox", value: "on", checked: true },
    { id: "cycle=60-7", type: "radio", value: "60-7", checked: false },
    { id: "", type: "number", value: "9", checked: false },
  ]);
  assert.deepStrictEqual(JSON.parse(raw), { v: 1, f: { "driven-h": "3", split: true, "cycle=60-7": false } });
  assert.deepStrictEqual(M.decode(raw), { "driven-h": "3", split: true, "cycle=60-7": false });
});

test("decode: мусор и чужие версии → null, чужие типы значений выбрасываются", () => {
  for (const bad of [null, undefined, 42, "", "{", "null", "[]", '{"v":2,"f":{}}', '{"v":1}', '{"v":1,"f":[]}', '{"v":1,"f":"x"}'])
    assert.strictEqual(M.decode(bad), null, String(bad));
  assert.deepStrictEqual(M.decode('{"v":1,"f":{"a":"1","b":true,"c":5,"d":null,"e":{}}}'), { a: "1", b: true });
});

test("iosHintDue: только iOS в браузере, после расчёта, один раз", () => {
  const base = { isIOS: true, standalone: false, seen: false, computed: true };
  assert.strictEqual(M.iosHintDue(base), true);
  assert.strictEqual(M.iosHintDue({ ...base, isIOS: false }), false);
  assert.strictEqual(M.iosHintDue({ ...base, standalone: true }), false);
  assert.strictEqual(M.iosHintDue({ ...base, seen: true }), false);
  assert.strictEqual(M.iosHintDue({ ...base, computed: false }), false);
});

test("sw routeFor: страницы калькулятора, их ассеты, всё прочее мимо", () => {
  const O = "https://loadlens.krait.studio";
  assert.strictEqual(SW.routeFor(O + "/hos-calculator/", O), "page");
  assert.strictEqual(SW.routeFor(O + "/ru/hos-calculator/?source=pwa", O), "page");
  assert.strictEqual(SW.routeFor(O + "/ro/hos-calculator/#faq", O), "page");
  assert.strictEqual(SW.routeFor(O + "/js/hos-trip.js", O), "asset");
  assert.strictEqual(SW.routeFor(O + "/css/site.css?x=1", O), "asset");
  for (const p of ["/", "/ru/", "/api/v1/telegram/install?lang=en", "/privacy.html", "/hos-calculator", "/stats.html"])
    assert.strictEqual(SW.routeFor(O + p, O), "pass", p);
  assert.strictEqual(SW.routeFor("https://mc.yandex.ru/metrika/tag.js", O), "pass");
});

test("sw: precache — все три языка калькулятора и скрипты страницы, кэш версионирован", () => {
  assert.deepStrictEqual(SW.CALC_PAGES, ["/hos-calculator/", "/ru/hos-calculator/", "/ro/hos-calculator/"]);
  for (const a of ["/js/hos-trip.js", "/js/hos-page.js", "/js/hos-mobile.js", "/js/hos-pwa.js", "/js/site.js", "/css/site.css", "/icons/icon-192.png"])
    assert.ok(SW.ASSETS.includes(a), a);
  for (const a of SW.ASSETS) assert.ok(require("node:fs").existsSync(path.join(PUB, a)), `нет файла ${a}`);
  assert.match(SW.CACHE, /^ll-hos-v\d+$/);
});
```

- [ ] **Step 2:** `node --test scripts/hos-mobile.test.js` → FAIL (`Cannot find module …hos-mobile.js`).
- [ ] **Step 3: Implement `backend/public/js/hos-mobile.js`**

```js
/* Чистая логика мобильного HOS-калькулятора: цвет плашки результата, запоминание формы, подсказка iOS.
   В браузере — глобальный LLHOSM, в node — module.exports (тест scripts/hos-mobile.test.js). */
(function (root) {
  "use strict";
  const KEY = "ll_hos_form";

  // Цвет плашки по тому, сколько можно ехать прямо сейчас (минуты).
  function level(r) {
    const d = Number(r && r.driveNow);
    if (!(d > 0)) return "bad";
    return d < 60 ? "warn" : "ok";
  }

  // Поля формы → JSON. Ключ — id (у радио без id — name=value), галки/радио — boolean, остальное — строка.
  function encode(fields) {
    const f = {};
    for (const x of fields) {
      if (!x.id) continue;
      f[x.id] = x.type === "checkbox" || x.type === "radio" ? !!x.checked : String(x.value);
    }
    return JSON.stringify({ v: 1, f });
  }

  // Обратное: что угодно из хранилища → карта значений или null (мусор, другая версия схемы).
  function decode(raw) {
    if (typeof raw !== "string") return null;
    let o;
    try { o = JSON.parse(raw); } catch (e) { return null; }
    if (!o || o.v !== 1 || !o.f || typeof o.f !== "object" || Array.isArray(o.f)) return null;
    const out = {};
    for (const [k, v] of Object.entries(o.f)) if (typeof v === "string" || typeof v === "boolean") out[k] = v;
    return out;
  }

  // Подсказка «Share → Add to Home Screen»: iOS не шлёт beforeinstallprompt, показываем один раз после расчёта.
  function iosHintDue(s) {
    return !!(s.isIOS && !s.standalone && !s.seen && s.computed);
  }

  const api = { KEY, level, encode, decode, iosHintDue };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LLHOSM = api;
})(this);
```

- [ ] **Step 4: Implement `backend/public/sw.js`**

```js
/* Service worker HOS-калькулятора: работает без сети и ставится на главный экран.
   Трогает ТОЛЬКО страницы калькулятора (сеть → кэш) и их ассеты (кэш, фоном обновляем).
   Лендинг, API, Метрика и всё прочее идут мимо. Новая версия кэша — поднять CACHE. */
const CACHE = "ll-hos-v1";
const CALC_PAGES = ["/hos-calculator/", "/ru/hos-calculator/", "/ro/hos-calculator/"];
const ASSETS = ["/js/hos-trip.js", "/js/hos-page.js", "/js/hos-mobile.js", "/js/hos-pwa.js", "/js/site.js",
  "/css/site.css", "/icon.png", "/icons/icon-192.png", "/icons/icon-512.png"];

function routeFor(url, origin) {
  const u = new URL(url, origin);
  if (u.origin !== origin) return "pass";
  if (CALC_PAGES.includes(u.pathname)) return "page";
  if (ASSETS.includes(u.pathname)) return "asset";
  return "pass";
}

if (typeof module === "object" && module.exports) {
  module.exports = { routeFor, CALC_PAGES, ASSETS, CACHE };
} else {
  const keyOf = (req) => new URL(req.url).pathname;
  const store = (req, res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(keyOf(req), copy)); }
    return res;
  };
  self.addEventListener("install", (e) => {
    e.waitUntil(caches.open(CACHE).then((c) => c.addAll([...CALC_PAGES, ...ASSETS])).then(() => self.skipWaiting()));
  });
  self.addEventListener("activate", (e) => {
    e.waitUntil(caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith("ll-hos-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
  });
  self.addEventListener("fetch", (e) => {
    if (e.request.method !== "GET") return;
    const route = routeFor(e.request.url, self.location.origin);
    if (route === "page") {
      e.respondWith(fetch(e.request).then((res) => store(e.request, res))
        .catch(() => caches.match(keyOf(e.request)).then((hit) => hit || Response.error())));
    } else if (route === "asset") {
      e.respondWith(caches.match(keyOf(e.request)).then((hit) => {
        const net = fetch(e.request).then((res) => store(e.request, res)).catch(() => hit || Response.error());
        return hit || net;
      }));
    }
  });
}
```

- [ ] **Step 5:** `node --test scripts/hos-mobile.test.js` → the `hos-pwa.js` existence assertion still FAILS (file not yet created); all others PASS.
- [ ] **Step 6: Implement `backend/public/js/hos-pwa.js`**

```js
/* HOS-калькулятор как приложение: регистрация service worker, кнопка «Add to Home Screen» (Android/Chrome,
   beforeinstallprompt) и разовая подсказка для iOS после первого расчёта. Цель Метрики a2hs. */
(function () {
  "use strict";
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
  }
  const $ = (id) => document.getElementById(id);
  const goal = (place) => {
    if (typeof window.ym === "function")
      window.ym(113205805, "reachGoal", "a2hs", { place, lang: document.documentElement.lang });
  };

  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; $("a2hs").hidden = false; });
  $("a2hs").addEventListener("click", async () => {
    if (!deferred) return;
    goal("prompt");
    deferred.prompt();
    try { await deferred.userChoice; } catch (e) {}
    deferred = null;
    $("a2hs").hidden = true;
  });

  const SEEN = "ll_a2hs_seen";
  // Хранилище недоступно → считаем, что уже показывали: лучше промолчать, чем показывать на каждом заходе.
  const seen = () => { try { return localStorage.getItem(SEEN) === "1"; } catch (e) { return true; } };
  const ua = navigator.userAgent || "";
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const form = $("calc");
  form.addEventListener("input", function once() {
    form.removeEventListener("input", once);
    if (!LLHOSM.iosHintDue({ isIOS, standalone, seen: seen(), computed: true })) return;
    $("a2hs-ios").hidden = false;
    goal("ios_hint");
    try { localStorage.setItem(SEEN, "1"); } catch (e) {}
  });
  $("a2hs-x").addEventListener("click", () => { $("a2hs-ios").hidden = true; });
})();
```

- [ ] **Step 7: Glue in `backend/public/js/hos-page.js`**

Replace the tail (from `function update() {` to the end) with:

```js
  const form = $("calc");
  // Ключ поля: id, у радио без id — name=value (их два набора: cycle и first-type).
  const fields = () => [...form.querySelectorAll("input")].map((el) =>
    ({ id: el.id || el.name + "=" + el.value, type: el.type, value: el.value, checked: el.checked, el }));

  // Ввод запоминаем, чтобы на повторном заходе не набирать часы заново. Хранилище недоступно — как раньше.
  function restore() {
    let saved = null;
    try { saved = LLHOSM.decode(localStorage.getItem(LLHOSM.KEY)); } catch (e) {}
    if (!saved) return;
    for (const x of fields()) {
      if (!(x.id in saved)) continue;
      if (x.type === "checkbox" || x.type === "radio") x.el.checked = saved[x.id] === true;
      else x.el.value = saved[x.id];
    }
  }
  function save() { try { localStorage.setItem(LLHOSM.KEY, LLHOSM.encode(fields())); } catch (e) {} }

  // Плашка внизу экрана (только узкие экраны, см. CSS): главный ответ и цвет, пока блок «Time left» не виден.
  const bar = $("hos-bar");
  function renderBar(r) {
    bar.className = "hos-bar " + LLHOSM.level(r);
    $("hos-bar-text").textContent = $("now").textContent;
  }
  bar.addEventListener("click", () => $("left-panel").scrollIntoView({ behavior: "smooth", block: "start" }));
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((es) => { bar.hidden = es[0].isIntersecting; }).observe($("left-panel"));
  }

  function update() {
    const st = readState();
    const sp = readSplit();
    $("split-fields").hidden = !sp;
    $("days-fields").hidden = !st.days;
    $("used-field").hidden = !!st.days;
    document.querySelector(".day.d7").hidden = st.cycle !== "70-8";
    const pair = sp && LLHOSTRIP.splitPair(st, sp);
    const r = pair ? pair.now : LLHOSTRIP.remaining(st);
    renderRemaining(st, r, pair);
    renderSplit(pair);
    // План ставит полные 10h reset; первый отдых пары только выводим из окна 14h.
    renderPlan(pair ? pair.state : st);
    renderBar(r);
  }

  form.addEventListener("input", () => { update(); save(); });
  $("reset").addEventListener("click", () => {
    try { localStorage.removeItem(LLHOSM.KEY); } catch (e) {}
    form.reset();
    update();
  });
  restore();
  update();
})();
```

(`save()` runs on user input only, not on load — so opening the page never overwrites a stored state.)

- [ ] **Step 8: Markup and styles in `backend/public/hos-calculator/index.html`**

1. Results panel: change `<div class="panel ym-hide-content" aria-live="polite">` to `<div class="panel ym-hide-content" id="left-panel" aria-live="polite">`.
2. Inside the same panel, change `<h2 data-i18n="r.title">Time left</h2>` to:

```html
          <div class="panel-head"><h2 data-i18n="r.title">Time left</h2><button type="button" class="linkbtn" id="reset" data-i18n="r.reset">Reset</button></div>
```

3. In `<section class="calc-head">`, after the lead paragraph:

```html
        <button type="button" class="btn ghost" id="a2hs" hidden data-i18n="m.a2hs">Add to Home Screen</button>
        <p class="note" id="a2hs-ios" hidden><span data-i18n="m.a2hs.ios">On iPhone: tap Share, then “Add to Home Screen”. The calculator then opens like an app and works without signal.</span> <button type="button" class="linkbtn" id="a2hs-x" aria-label="Close">×</button></p>
```

4. Right before `<footer>`:

```html
  <button type="button" class="hos-bar" id="hos-bar" hidden><span id="hos-bar-text"></span></button>
```

5. In the page `<style>`, append:

```css
    .panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .linkbtn { background: none; border: 0; padding: 0; color: var(--blue); font: inherit; cursor: pointer; text-decoration: underline; }
    #a2hs { margin-top: 16px; }
    .hos-bar { display: none; }
    @media (max-width: 860px) {
      .hos-bar { display: block; position: fixed; left: 0; right: 0; bottom: 0; z-index: 15; width: 100%;
        border: 0; border-top: 1px solid var(--line); padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
        font: 600 15px/1.35 inherit; text-align: left; color: var(--ink); background: var(--card);
        box-shadow: var(--shadow); cursor: pointer; }
      .hos-bar[hidden] { display: none; }
      .hos-bar.ok { background: var(--green-bg); }
      .hos-bar.warn { background: var(--amber-bg); }
      .hos-bar.bad { background: var(--red-bg); }
      .consent-open .hos-bar { bottom: 76px; }
      main { padding-bottom: 72px; }
    }
```

(`.consent-open` is set on `<html>` by site.js in Task 5; until then the bar sits under the banner — acceptable intermediate state.)

6. Scripts at the end of `<body>`:

```html
  <script src="/js/hos-trip.js"></script>
  <script src="/js/hos-mobile.js"></script>
  <script src="/js/hos-page.js"></script>
  <script src="/js/hos-pwa.js"></script>
  <script src="/js/site.js"></script>
```

7. `landing/hos-calculator.i18n.json` — add to `ru`: `"r.reset": "Сбросить"`, `"m.a2hs": "Добавить на главный экран"`, `"m.a2hs.ios": "На iPhone: нажмите «Поделиться», затем «На экран „Домой“». Калькулятор откроется как приложение и будет работать без связи."`; to `ro`: `"r.reset": "Resetează"`, `"m.a2hs": "Adaugă pe ecranul principal"`, `"m.a2hs.ios": "Pe iPhone: apăsați Partajare, apoi „Adaugă pe ecranul principal”. Calculatorul se deschide ca o aplicație și merge fără semnal."`

8. In `scripts/landing-i18n.test.js`, test "калькулятор: кнопка установки с utm_source=hos_calc…", replace the script-order `assert.match` with:

```js
  assert.match(calcHtml, /<script src="\/js\/hos-trip\.js"><\/script>\s*<script src="\/js\/hos-mobile\.js"><\/script>\s*<script src="\/js\/hos-page\.js"><\/script>\s*<script src="\/js\/hos-pwa\.js"><\/script>\s*<script src="\/js\/site\.js"><\/script>\s*<\/body>/);
```

and append this test:

```js
test("калькулятор: плашка результата, сброс, установка на экран; ввод сохраняется только по вводу пользователя", () => {
  for (const id of ["left-panel", "hos-bar", "hos-bar-text", "reset", "a2hs", "a2hs-ios", "a2hs-x"])
    assert.match(calcHtml, new RegExp(`id="${id}"`), id);
  assert.match(calcHtml, /id="hos-bar" hidden/);
  assert.match(calcHtml, /id="a2hs" hidden/);
  assert.match(hosPageJs, /form\.addEventListener\("input", \(\) => \{ update\(\); save\(\); \}\)/);
  assert.doesNotMatch(hosPageJs.split("restore();\n  update();")[1] || "", /save\(\)/, "загрузка страницы не должна перезаписывать сохранённое");
});
```

- [ ] **Step 9:** `npm run build:landing && npm test` → PASS (incl. `scripts/hos-mobile.test.js`).
- [ ] **Step 10: Manual smoke** — `cd backend/public && python3 -m http.server 8099` then the Read tool on a Playwright screenshot is done in Task 9; here just open `http://localhost:8099/hos-calculator/` in Chrome DevTools mobile mode: type hours → bar text changes; reload → values kept; Reset → defaults. Stop the server.
- [ ] **Step 11: Commit**

```bash
git add backend/public/js/hos-mobile.js backend/public/js/hos-pwa.js backend/public/js/hos-page.js backend/public/sw.js backend/public/hos-calculator backend/public/ru/hos-calculator backend/public/ro/hos-calculator landing/hos-calculator.i18n.json scripts/hos-mobile.test.js scripts/landing-i18n.test.js
git commit -m "feat(hos-calc): плашка результата, запоминание ввода, офлайн и установка на экран"
```

---

### Task 4: Phone detection + mobile CTAs (landing and calculator)

**Files:**
- Modify: `backend/public/index.html`, `backend/public/hos-calculator/index.html`, `backend/public/css/site.css`, `backend/public/js/site.js`, `scripts/build-landing.js` (`page()`), `landing/i18n.json`, `scripts/landing-i18n.test.js`

**Interfaces:**
- Consumes: `/api/v1/telegram/install?lang=<en|ru|ro>&place=<place>` (implemented in Task 7; until deployed the link 404s — fine, the branch ships together).
- Produces: `<html class="is-mobile">` on phones; CSS classes `.cta-desktop`, `.cta-mobile`; attributes `data-share="<place>"`, `data-tg="<place>"`; hidden `#share-text`.

Places: landing `hero`, `pricing`, `final`; calculator `hos_calc`.

- [ ] **Step 1: Write the failing tests** (append to `scripts/landing-i18n.test.js`)

```js
const vm = require("node:vm");
const mobileSnippet = (page) => (page.match(/<script>\/\*ll-mobile\*\/([\s\S]*?)<\/script>/) || [])[1];

test("is-mobile: скрипт в <head> обеих страниц, до стилей, и не затирается редиректом языка", () => {
  for (const src of [html, calcHtml]) {
    const head = src.split("</head>")[0];
    assert.ok(mobileSnippet(head), "нет скрипта ll-mobile");
    assert.ok(head.indexOf("/*ll-mobile*/") < head.indexOf('href="/css/site.css"'));
    assert.doesNotMatch(head, /documentElement\.className\s*=/, "className = затирает is-mobile");
  }
});

test("is-mobile: телефоны и iPadOS — да, компьютеры — нет", () => {
  const run = (ua, touch) => {
    const added = [];
    vm.runInNewContext(mobileSnippet(html), {
      navigator: { userAgent: ua, maxTouchPoints: touch },
      document: { documentElement: { classList: { add: (c) => added.push(c) } } },
    });
    return added.includes("is-mobile");
  };
  assert.strictEqual(run("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5), true);
  assert.strictEqual(run("Mozilla/5.0 (Linux; Android 15; Pixel 9)", 5), true);
  assert.strictEqual(run("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari", 5), true); // iPadOS
  assert.strictEqual(run("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130", 0), false);
  assert.strictEqual(run("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130", 0), false);
  assert.strictEqual(run("Mozilla/5.0 (X11; CrOS x86_64) Chrome/130", 10), false); // Chromebook с тачем ставит расширения
});

test("мобильные кнопки рядом с каждой кнопкой установки; Telegram — через бэкенд с языком страницы", () => {
  const places = (src, attr) => [...src.matchAll(new RegExp(`${attr}="([^"]+)"`, "g"))].map((m) => m[1]).sort();
  assert.deepStrictEqual(places(html, "data-share"), ["final", "hero", "pricing"]);
  assert.deepStrictEqual(places(html, "data-tg"), ["final", "hero", "pricing"]);
  assert.deepStrictEqual(places(calcHtml, "data-share"), ["hos_calc"]);
  assert.deepStrictEqual(places(calcHtml, "data-tg"), ["hos_calc"]);
  for (const src of [html, calcHtml]) {
    for (const a of src.matchAll(/<a [^>]*data-cws="[^"]+"[^>]*>/g)) assert.match(a[0], /class="[^"]*\bcta-desktop\b/, a[0]);
    assert.match(src, /<span id="share-text" hidden data-i18n="m\.sharetext">/);
  }
  for (const lang of ["ru", "ro"]) {
    const page = built[path.join(lang, "index.html")];
    const tg = [...page.matchAll(/href="(\/api\/v1\/telegram\/install\?[^"]+)"/g)].map((m) => m[1]);
    assert.strictEqual(tg.length, 3);
    for (const h of tg) assert.match(h, new RegExp(`^/api/v1/telegram/install\\?lang=${lang}&amp;place=\\w+$`));
  }
  assert.match(html, /href="\/api\/v1\/telegram\/install\?lang=en&amp;place=hero"/);
});

test("site.js: share с отменой без mailto, цели share_link и tg_install", () => {
  assert.match(siteJs, /navigator\.share/);
  assert.match(siteJs, /AbortError/);
  assert.match(siteJs, /mailto:\?subject=/);
  assert.match(siteJs, /'share_link'|"share_link"/);
  assert.match(siteJs, /'tg_install'|"tg_install"/);
});
```

- [ ] **Step 2:** `node --test scripts/landing-i18n.test.js` → FAIL on the new tests.
- [ ] **Step 3: Head script and redirect fix** — in BOTH `backend/public/index.html` and `backend/public/hos-calculator/index.html`:
  1. Find `document.documentElement.className = "i18n-pending";` → replace with `document.documentElement.classList.add("i18n-pending");`. Then `grep -rn "className" backend/public/index.html backend/public/hos-calculator/index.html backend/public/js/site.js` must show nothing that assigns `documentElement.className`.
  2. Insert directly after `<meta name="viewport" …>` (before the `site.css` link):

```html
  <script>/*ll-mobile*/(function(n){var u=n.userAgent||"";if(/Android|iPhone|iPad|iPod/.test(u)||(/Macintosh/.test(u)&&n.maxTouchPoints>1))document.documentElement.classList.add("is-mobile")})(navigator)</script>
```

- [ ] **Step 4: CSS** — append to `backend/public/css/site.css`:

```css
/* Телефон: расширение не поставить → вместо «Add to Chrome» «Send me the link» / Telegram. Класс is-mobile — скрипт в <head>. */
.cta-mobile { display: none; }
.is-mobile .cta-desktop { display: none !important; }
.is-mobile .cta-mobile { display: block; }
.cta-mobile .btns { display: flex; flex-direction: column; gap: 10px; margin: 20px 0 8px; }
.cta-mobile .btn { width: 100%; font-family: inherit; cursor: pointer; }
.cta-mobile .m-calc { display: inline-block; margin-top: 6px; font-weight: 600; }
```

- [ ] **Step 5: Landing markup** (`backend/public/index.html`)
  1. Add ` cta-desktop` to the `class` of each of the three `data-cws` anchors (`hero`, `pricing`, `final`), e.g. `class="btn primary cta-desktop"`.
  2. Hero: directly after the closing `</div>` of `<div class="ctas">` (line ~138), insert:

```html
          <div class="cta-mobile">
            <div class="btns">
              <button type="button" class="btn primary" data-share="hero" data-i18n="m.share">Send me the link</button>
              <a class="btn ghost" data-tg="hero" href="/api/v1/telegram/install?lang=en&amp;place=hero" rel="nofollow" data-i18n="m.tg">Get it in Telegram</a>
            </div>
            <p class="mut small" data-i18n="m.why">LoadLens is a Chrome extension for your laptop or desktop.</p>
            <a class="m-calc" data-local href="/hos-calculator/" data-i18n="m.calc">Try the free HOS calculator →</a>
          </div>
```

  3. Pricing (Free card): directly after the `data-cws="pricing"` anchor's closing `</a>`, insert the same block with `place=pricing`, `data-share="pricing"`, `data-tg="pricing"`, and WITHOUT the `m-calc` link.
  4. Final section: directly after its `<div class="ctas">…</div>`, insert the block with `place=final` / `"final"`, without `m-calc`.
  5. In the footer, right after `<footer>\n    <div class="wrap">`, insert `<span id="share-text" hidden data-i18n="m.sharetext">LoadLens: load profit, HOS and broker checks on your load board. Open this on your computer in Chrome.</span>`

- [ ] **Step 6: Calculator markup** (`backend/public/hos-calculator/index.html`)
  1. `data-cws="hos_calc"` anchor: `class="btn primary cta-desktop"`.
  2. After the `<div class="ctas">…</div>` in `<section class="alt cta">`, insert the block with `place=hos_calc`, `data-share="hos_calc"`, `data-tg="hos_calc"`, no `m-calc`, and add `style="max-width: 420px; margin: 0 auto"` on the outer `<div class="cta-mobile">`.
  3. Footer: the same `#share-text` span as on the landing.

- [ ] **Step 7: build-landing rewrites the Telegram link language** — in `scripts/build-landing.js` `page()`, inside `if (lang !== "en") { … }`, append to the `html = html.replace(...)` chain:

```js
      .replace(/(\/api\/v1\/telegram\/install\?lang=)en\b/g, `$1${lang}`)
```

- [ ] **Step 8: Translations** — `landing/i18n.json` (common dict, used by both pages):
  - `ru`: `"m.share": "Отправить себе ссылку"`, `"m.tg": "Получить в Telegram"`, `"m.why": "LoadLens — расширение Chrome для ноутбука или компьютера."`, `"m.calc": "Попробуйте бесплатный HOS-калькулятор →"`, `"m.sharetext": "LoadLens: выгодность груза, HOS и проверка брокера прямо на борде. Откройте на компьютере в Chrome."`
  - `ro`: `"m.share": "Trimite-mi linkul"`, `"m.tg": "Primește-l în Telegram"`, `"m.why": "LoadLens este o extensie Chrome pentru laptop sau desktop."`, `"m.calc": "Încearcă calculatorul HOS gratuit →"`, `"m.sharetext": "LoadLens: profitul cursei, HOS și verificarea brokerului direct pe bursă. Deschide pe calculator în Chrome."`

- [ ] **Step 9: site.js** — append to `backend/public/js/site.js`:

```js
/* Телефон: «Send me the link» — системное меню «Поделиться», без него — письмо самому себе. Отмена меню
   (AbortError) — ничего не делаем. «Get it in Telegram» — обычная ссылка на бэкенд (302 на бота). Цели Метрики. */
(function () {
  const lang = document.documentElement.lang || "en";
  const goal = (name, place) => {
    if (typeof window.ym === "function") window.ym(113205805, "reachGoal", name, { place, lang });
  };
  const textEl = document.getElementById("share-text");
  for (const b of document.querySelectorAll("[data-share]")) {
    b.addEventListener("click", async () => {
      goal("share_link", b.dataset.share);
      const url = location.origin + (lang === "en" ? "/" : "/" + lang + "/") + "?utm_source=share";
      const text = textEl ? textEl.textContent.trim() : "LoadLens";
      if (navigator.share) {
        try { await navigator.share({ title: "LoadLens", text, url }); return; }
        catch (e) { if (e && e.name === "AbortError") return; }
      }
      location.href = "mailto:?subject=" + encodeURIComponent("LoadLens") + "&body=" + encodeURIComponent(text + "\n\n" + url);
    });
  }
  for (const a of document.querySelectorAll("[data-tg]")) a.addEventListener("click", () => goal("tg_install", a.dataset.tg));
})();
```

- [ ] **Step 10:** `npm run build:landing && npm test` → PASS.
- [ ] **Step 11: Commit**

```bash
git add backend/public scripts/build-landing.js scripts/landing-i18n.test.js landing/i18n.json
git commit -m "feat(site): на телефоне вместо Add to Chrome — отправить ссылку себе или получить в Telegram"
```

---

### Task 5: Compact cookie banner on phones

**Files:**
- Modify: `backend/public/index.html`, `backend/public/hos-calculator/index.html` (consent markup), `backend/public/css/site.css`, `backend/public/js/site.js`, `landing/i18n.json`, `scripts/landing-i18n.test.js`

**Interfaces:** Produces `html.consent-open` while the banner is visible (consumed by `.consent-open .hos-bar` from Task 3).

- [ ] **Step 1: Failing test** (append)

```js
test("баннер cookies: короткий текст для телефона на всех языках, класс consent-open для плашки калькулятора", () => {
  for (const src of [html, calcHtml]) {
    assert.match(src, /<span class="ck-long" data-i18n="ck\.text">/);
    assert.match(src, /<span class="ck-short" data-i18n="ck\.short">/);
  }
  for (const lang of ["ru", "ro"]) assert.ok((I18N[lang]["ck.short"] || "").length <= 60);
  assert.match(siteJs, /classList\.toggle\("consent-open"/);
  assert.doesNotMatch(siteJs, /banner\.hidden = (true|false)/, "показ/скрытие только через show()");
});
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Markup** — in both pages replace the consent `<p>` opening:

```html
    <p><span class="ck-long" data-i18n="ck.text">We use Yandex Metrica cookies to see how visitors use this page, including session replay. Nothing loads until you accept.</span><span class="ck-short" data-i18n="ck.short">Analytics cookies, only if you accept.</span>
```

(keep the following `<a href="/privacy.html#website" data-i18n="ck.more">Details</a></p>` unchanged).

- [ ] **Step 4: CSS** — append to `site.css`:

```css
.ck-short { display: none; }
@media (max-width: 600px) {
  .consent { left: 8px; right: 8px; bottom: 8px; padding: 10px 12px; gap: 10px; flex-wrap: nowrap; }
  .consent p { flex: 1 1 auto; font-size: 13px; line-height: 1.35; }
  .ck-long { display: none; }
  .ck-short { display: inline; }
  .consent .btn { min-height: 36px; padding: 6px 12px; font-size: 14px; }
}
```

- [ ] **Step 5: site.js** — inside the consent IIFE, after `const set = …`, add `const show = (v) => { banner.hidden = !v; document.documentElement.classList.toggle("consent-open", v); };` and replace every `banner.hidden = true` with `show(false)` and `banner.hidden = false` with `show(true)` (4 places: ck-yes, ck-no, ck-open, final `else if`).
- [ ] **Step 6: Translations** — `landing/i18n.json`: `ru` `"ck.short": "Cookies аналитики — только с вашего согласия."`, `ro` `"ck.short": "Cookie-uri de analiză, doar cu acordul tău."`
- [ ] **Step 7:** `npm run build:landing && npm test` → PASS.
- [ ] **Step 8: Commit** `git add backend/public landing/i18n.json scripts/landing-i18n.test.js && git commit -m "feat(site): компактный баннер cookies на телефоне"`

---

### Task 6: Other pages at 390px

**Files:**
- Modify (only if the check fails): `backend/public/stats.html`, `privacy.html`, `terms.html`, `refund.html` inline styles or `css/site.css`
- Create: `scripts/mobile-site.e2e.py` (first part — the width check; Task 9 extends it)

- [ ] **Step 1: Write the check**

```python
#!/usr/bin/env python3
"""Мобильная проверка сайта в Playwright (iPhone 13 и десктоп). Поднимает статику backend/public на localhost.
Запуск: npm run e2e:mobile (нужен python playwright + chromium)."""
import functools, http.server, os, sys, threading
from playwright.sync_api import sync_playwright

PUB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend", "public")
PAGES = ["/", "/ru/", "/ro/", "/hos-calculator/", "/ru/hos-calculator/", "/ro/hos-calculator/",
         "/stats.html", "/privacy.html", "/terms.html", "/refund.html"]
fails = []

def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond: fails.append(msg)

def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=PUB)
    h.log_message = lambda *a: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_port}"

def no_hscroll(p, base):
    ctx = p.chromium.launch().new_context(**p.devices["iPhone 13"], locale="en-US")
    for path in PAGES:
        pg = ctx.new_page()
        pg.goto(base + path, wait_until="domcontentloaded")
        sw, cw = pg.evaluate("[document.documentElement.scrollWidth, innerWidth]")
        check(sw <= cw, f"{path}: нет горизонтального скролла ({sw} <= {cw})")
        pg.close()
    ctx.browser.close()

if __name__ == "__main__":
    srv, base = serve()
    with sync_playwright() as p:
        no_hscroll(p, base)
    srv.shutdown()
    print(f"\n{len(fails)} fail(s)")
    sys.exit(1 if fails else 0)
```

Add to root `package.json` scripts: `"e2e:mobile": "python3 -I scripts/mobile-site.e2e.py"`.

- [ ] **Step 2:** `npm run e2e:mobile` → note every FAIL path.
- [ ] **Step 3: Fix each failing page** with the narrowest CSS: wide tables → wrap the `<table>` in `<div style="overflow-x:auto">…</div>`; long `<code>`/URLs → add to that page's `<style>`: `code { overflow-wrap: anywhere; }`. Do not change colors or fonts.
- [ ] **Step 4:** `npm run e2e:mobile` → `0 fail(s)`.
- [ ] **Step 5: Commit** `git add backend/public scripts/mobile-site.e2e.py package.json && git commit -m "fix(site): страницы без горизонтального скролла на телефоне + e2e:mobile"`

---

### Task 7: Bot — `/start install`, install redirect, `install_leads`

**Files:**
- Create: `backend/src/telegram/install.ts`, `backend/src/telegram/install-lead.model.ts`, `backend/src/telegram/install.spec.ts`
- Modify: `backend/src/telegram/telegram.service.ts` (constructor, `handleWebhook`), `backend/src/telegram/telegram.controller.ts` (`GET install`), `backend/src/telegram/telegram.module.ts`, `backend/src/app.module.ts` (models list), `backend/src/telegram/telegram.service.spec.ts`

**Interfaces:**
- Produces (`install.ts`):
  - `type InstallLang = 'en' | 'ru' | 'ro'`
  - `CWS_INSTALL_URL`, `LANDING_URL`, `REMIND_AFTER_MS = 86_400_000`, `REMIND_WINDOW_MS = 604_800_000`, `LEAD_TTL_MS = 2_592_000_000`
  - `normalizeLang(x: unknown): InstallLang`
  - `parseInstallStart(text: string): InstallLang | null`
  - `installReplyText(lang: InstallLang): string`, `installReminderText(lang: InstallLang): string`
  - `installRedirectUrl(botUsername: string | null, lang: unknown): string`
- Produces model `InstallLead { chatId: string; lang: string; createdAt: Date; remindedAt: Date | null }` (table `install_leads`).
- HTTP: `GET /api/v1/telegram/install?lang=ru&place=hero` → 302.

- [ ] **Step 1: Failing tests** — `backend/src/telegram/install.spec.ts`

```ts
import {
  parseInstallStart, normalizeLang, installReplyText, installReminderText, installRedirectUrl, CWS_INSTALL_URL, LANDING_URL,
} from './install';

describe('parseInstallStart', () => {
  it.each([
    ['/start install', 'en'], ['/start install_en', 'en'], ['/start install_ru', 'ru'], ['/start install_ro', 'ro'],
    ['/start@LoadLensBot install_ru', 'ru'], ['/start install_ro  ', 'ro'],
  ])('%s → %s', (text, lang) => expect(parseInstallStart(text)).toBe(lang));

  it.each(['/start', '/start abcdef1234567890', '/start install_de', '/start installx', 'install_ru', '', '/start install_ru extra'])(
    '%s → null', (text) => expect(parseInstallStart(text)).toBeNull());

  it('не падает на не-строке', () => expect(parseInstallStart(undefined as any)).toBeNull());
});

describe('тексты и редирект', () => {
  it('ответ и напоминание на трёх языках содержат ссылку на CWS с utm_source=telegram', () => {
    for (const l of ['en', 'ru', 'ro'] as const) {
      expect(installReplyText(l)).toContain(CWS_INSTALL_URL);
      expect(installReminderText(l)).toContain(CWS_INSTALL_URL);
    }
    expect(CWS_INSTALL_URL).toMatch(/utm_source=telegram$/);
    expect(installReplyText('ru')).toMatch(/Chrome/);
    expect(installReplyText('en')).not.toBe(installReplyText('ru'));
  });

  it('normalizeLang: неизвестное → en', () => {
    expect(normalizeLang('ro')).toBe('ro');
    expect(normalizeLang('de')).toBe('en');
    expect(normalizeLang(undefined)).toBe('en');
  });

  it('редирект: бот из env + язык; без бота — лендинг', () => {
    expect(installRedirectUrl('LoadLensBot', 'ru')).toBe('https://t.me/LoadLensBot?start=install_ru');
    expect(installRedirectUrl('LoadLensBot', 'xx')).toBe('https://t.me/LoadLensBot?start=install_en');
    expect(installRedirectUrl(null, 'ru')).toBe(LANDING_URL);
  });
});
```

Append to `backend/src/telegram/telegram.service.spec.ts` (inside the file, after the existing `handleWebhook` describe):

```ts
describe('TelegramService.handleWebhook: /start install', () => {
  beforeEach(() => { process.env.TELEGRAM_WEBHOOK_SECRET = 'sec'; process.env.TELEGRAM_BOT_TOKEN = 'T'; });
  const mk = () => {
    const users = { update: jest.fn().mockResolvedValue([0]) };
    const leads = { findOrCreate: jest.fn().mockResolvedValue([{}, true]) };
    const send = jest.fn().mockResolvedValue(true);
    const s = new TelegramService(users as any, {} as any, leads as any);
    (s as any).send = send;
    return { s, users, leads, send };
  };

  it('install_ru: сохраняет заявку, отвечает по-русски, токен привязки не трогает', async () => {
    const { s, users, leads, send } = mk();
    await s.handleWebhook('sec', { message: { chat: { id: 777 }, text: '/start install_ru' } });
    expect(leads.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({ where: { chatId: '777' } }));
    expect(leads.findOrCreate.mock.calls[0][0].defaults).toEqual(expect.objectContaining({ chatId: '777', lang: 'ru', remindedAt: null }));
    expect(users.update).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('777', expect.stringContaining('Chrome'));
    expect(send.mock.calls[0][1]).not.toContain('expired');
  });

  it('повтор: findOrCreate не перезаписывает старую заявку (напоминание не сбрасывается)', async () => {
    const { s, leads } = mk();
    await s.handleWebhook('sec', { message: { chat: { id: 777 }, text: '/start install' } });
    expect(leads.findOrCreate).toHaveBeenCalledTimes(1);
    expect(leads).not.toHaveProperty('upsert');
  });

  it('без токена бота заявку пишем, но не отвечаем', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const { s, leads, send } = mk();
    await s.handleWebhook('sec', { message: { chat: { id: 1 }, text: '/start install_en' } });
    expect(leads.findOrCreate).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2:** `cd backend && npx jest src/telegram` → FAIL (`Cannot find module './install'`).
- [ ] **Step 3: Implement `backend/src/telegram/install.ts`**

```ts
// Установка с телефона через бота: сайт ведёт на /telegram/install → 302 на t.me/<бот>?start=install_<lang>,
// бот присылает ссылку на Chrome Web Store и через сутки один раз напоминает (install-reminders.service).
export type InstallLang = 'en' | 'ru' | 'ro';
export const INSTALL_LANGS: InstallLang[] = ['en', 'ru', 'ro'];
export const CWS_INSTALL_URL =
  'https://chromewebstore.google.com/detail/chemnjopdclcmcckgfbmabielhobmknk?utm_source=telegram';
export const LANDING_URL = 'https://loadlens.krait.studio/';
export const REMIND_AFTER_MS = 24 * 60 * 60 * 1000;
export const REMIND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const LEAD_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeLang(x: unknown): InstallLang {
  return INSTALL_LANGS.includes(x as InstallLang) ? (x as InstallLang) : 'en';
}

// '/start install' | '/start install_<lang>' (+ @bot) → язык. Проверять ДО parseStartCommand:
// 'install_ru' подходит и под формат токена привязки.
export function parseInstallStart(text: string): InstallLang | null {
  const m = /^\/start(?:@\w+)?\s+install(?:_(en|ru|ro))?\s*$/.exec(String(text || ''));
  return m ? ((m[1] as InstallLang) || 'en') : null;
}

const REPLY: Record<InstallLang, string> = {
  en: "Here's LoadLens for your computer:\n{url}\n\nOpen it in Chrome on your laptop or desktop. I'll remind you once tomorrow.",
  ru: 'Вот LoadLens для компьютера:\n{url}\n\nОткройте ссылку в Chrome на ноутбуке или компьютере. Завтра напомню один раз.',
  ro: 'Iată LoadLens pentru calculator:\n{url}\n\nDeschideți linkul în Chrome pe laptop sau desktop. Vă reamintesc o singură dată mâine.',
};
const REMINDER: Record<InstallLang, string> = {
  en: 'Did you get LoadLens on your computer? Here is the link again:\n{url}',
  ru: 'Получилось поставить LoadLens на компьютер? Ссылка ещё раз:\n{url}',
  ro: 'Ați reușit să instalați LoadLens pe calculator? Iată linkul din nou:\n{url}',
};

export const installReplyText = (lang: InstallLang) => REPLY[lang].replace('{url}', CWS_INSTALL_URL);
export const installReminderText = (lang: InstallLang) => REMINDER[lang].replace('{url}', CWS_INSTALL_URL);

export function installRedirectUrl(botUsername: string | null, lang: unknown): string {
  return botUsername ? `https://t.me/${botUsername}?start=install_${normalizeLang(lang)}` : LANDING_URL;
}
```

- [ ] **Step 4: Model** — `backend/src/telegram/install-lead.model.ts`

```ts
import { Column, DataType, Model, Table } from 'sequelize-typescript';

// Заявка «пришли ссылку на установку» из бота (/start install_<lang>). Только id чата и язык;
// одно напоминание через сутки, запись живёт 30 дней (install-reminders.service).
@Table({ tableName: 'install_leads', underscored: true, timestamps: false })
export class InstallLead extends Model {
  @Column({ type: DataType.TEXT, primaryKey: true, field: 'chat_id' })
  chatId: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  lang: string;

  @Column({ type: DataType.DATE, allowNull: false, field: 'created_at' })
  createdAt: Date;

  @Column({ type: DataType.DATE, allowNull: true, field: 'reminded_at' })
  remindedAt: Date | null;
}
```

Register: `backend/src/app.module.ts` models array → add `InstallLead` (import from `./telegram/install-lead.model`); `telegram.module.ts` → `SequelizeModule.forFeature([User, AlertSend, InstallLead])`.

- [ ] **Step 5: Service** — `telegram.service.ts`:
  - imports: `import { InstallLead } from './install-lead.model';` and `import { parseInstallStart, installReplyText } from './install';`
  - constructor gains a third param: `@InjectModel(InstallLead) private readonly leads: typeof InstallLead,`
  - in `handleWebhook`, right after `const chatId = msg?.chat?.id;` insert:

```ts
    // Установка с телефона: проверяем раньше токена привязки — 'install_ru' подходит и под его формат.
    const installLang = parseInstallStart(msg?.text || '');
    if (chatId && installLang) {
      await this.leads.findOrCreate({
        where: { chatId: String(chatId) },
        defaults: { chatId: String(chatId), lang: installLang, createdAt: new Date(), remindedAt: null },
      });
      if (this.token) await this.send(String(chatId), installReplyText(installLang));
      return { ok: true };
    }
```

- [ ] **Step 6: Controller** — `telegram.controller.ts`: extend the `@nestjs/common` import with `Query, Redirect`; add `import { installRedirectUrl } from './install';` and the route:

```ts
  // Кнопка «Get it in Telegram» на сайте (телефон): 302 на бота с языком страницы. Имя бота — из env,
  // поэтому на статических страницах его нет. Без env — на лендинг.
  @Get('install')
  @Redirect()
  install(@Query('lang') lang?: string) {
    return { url: installRedirectUrl(process.env.TELEGRAM_BOT_USERNAME || null, lang), statusCode: 302 };
  }
```

- [ ] **Step 7:** `cd backend && npx jest src/telegram && npm run build` → PASS, build ok.
- [ ] **Step 8: Commit** `git add backend/src && git commit -m "feat(telegram): /start install — ссылка на установку для телефона, редирект /telegram/install"`

---

### Task 8: Bot — one reminder after 24h + privacy

**Files:**
- Create: `backend/src/telegram/install-reminders.service.ts`, `backend/src/telegram/install-reminders.service.spec.ts`
- Modify: `backend/src/telegram/install.ts` (pure `decideReminders`), `backend/src/telegram/telegram.module.ts` (provider), `backend/public/privacy.html`, `scripts/landing-i18n.test.js`

**Interfaces:**
- Consumes: `InstallLead`, `installReminderText`, `normalizeLang`, `REMIND_*`, `LEAD_TTL_MS` (Task 7); `TelegramService.sendMessageTo(chatId, text): Promise<boolean>`.
- Produces: `decideReminders(leads: {chatId:string;lang:string;createdAt:Date;remindedAt:Date|null}[], linked: Set<string>, now: number): { send: {chatId:string;lang:InstallLang}[]; mark: string[] }`; `InstallRemindersService.run(now?: number): Promise<{sent:number; skipped:number; deleted:number}>`.

- [ ] **Step 1: Failing tests** — `backend/src/telegram/install-reminders.service.spec.ts`

```ts
import { decideReminders, REMIND_AFTER_MS, REMIND_WINDOW_MS, LEAD_TTL_MS } from './install';
import { InstallRemindersService } from './install-reminders.service';

const NOW = Date.UTC(2026, 9, 8, 12);
const lead = (chatId: string, ageMs: number, extra: any = {}) =>
  ({ chatId, lang: 'ru', createdAt: new Date(NOW - ageMs), remindedAt: null, ...extra });
const H = 3600 * 1000;

describe('decideReminders', () => {
  it('только 24ч ≤ возраст < 7д, без напоминания, непривязанные; привязанные — только пометить', () => {
    const d = decideReminders([
      lead('fresh', 23 * H),
      lead('due', 25 * H),
      lead('edge', REMIND_AFTER_MS),
      lead('old', REMIND_WINDOW_MS + H),
      lead('done', 30 * H, { remindedAt: new Date(NOW - H) }),
      lead('linked', 30 * H),
    ], new Set(['linked']), NOW);
    expect(d.send).toEqual([{ chatId: 'due', lang: 'ru' }, { chatId: 'edge', lang: 'ru' }]);
    expect(d.mark.sort()).toEqual(['due', 'edge', 'linked']);
  });

  it('незнакомый язык в базе → en', () => {
    expect(decideReminders([lead('x', 25 * H, { lang: 'de' })], new Set(), NOW).send).toEqual([{ chatId: 'x', lang: 'en' }]);
  });
});

describe('InstallRemindersService.run', () => {
  const mk = (rows: any[], linked: string[], sendOk = true) => {
    const leads = {
      destroy: jest.fn().mockResolvedValue(2),
      findAll: jest.fn().mockResolvedValue(rows),
      update: jest.fn().mockResolvedValue([1]),
    };
    const users = { findAll: jest.fn().mockResolvedValue(linked.map((c) => ({ telegramChatId: c }))) };
    const telegram = { sendMessageTo: jest.fn().mockResolvedValue(sendOk) };
    return { svc: new InstallRemindersService(leads as any, users as any, telegram as any), leads, users, telegram };
  };

  it('чистит старше 30 дней, шлёт напоминание, помечает reminded_at', async () => {
    const { svc, leads, telegram } = mk([lead('due', 25 * H)], []);
    const r = await svc.run(NOW);
    expect(leads.destroy.mock.calls[0][0].where.createdAt).toBeDefined();
    expect(r).toEqual({ sent: 1, skipped: 0, deleted: 2 });
    expect(telegram.sendMessageTo).toHaveBeenCalledWith('due', expect.stringContaining('LoadLens'));
    expect(leads.update).toHaveBeenCalledWith({ remindedAt: new Date(NOW) }, { where: { chatId: 'due' } });
  });

  it('ошибка отправки (бот заблокирован) — всё равно помечаем, чтобы не стучаться каждый час', async () => {
    const { svc, leads } = mk([lead('due', 25 * H)], [], false);
    const r = await svc.run(NOW);
    expect(r.sent).toBe(0);
    expect(leads.update).toHaveBeenCalledWith({ remindedAt: new Date(NOW) }, { where: { chatId: 'due' } });
  });

  it('привязанный чат не получает напоминания, но помечается', async () => {
    const { svc, leads, telegram } = mk([lead('linked', 25 * H)], ['linked']);
    const r = await svc.run(NOW);
    expect(telegram.sendMessageTo).not.toHaveBeenCalled();
    expect(r.skipped).toBe(1);
    expect(leads.update).toHaveBeenCalledTimes(1);
  });

  it('нет кандидатов — users не запрашиваем', async () => {
    const { svc, users } = mk([], []);
    await svc.run(NOW);
    expect(users.findAll).not.toHaveBeenCalled();
  });

  it('LEAD_TTL_MS = 30 дней', () => expect(LEAD_TTL_MS).toBe(30 * 24 * H));
});
```

- [ ] **Step 2:** `cd backend && npx jest install-reminders` → FAIL.
- [ ] **Step 3: Pure decision** — append to `backend/src/telegram/install.ts`:

```ts
export interface LeadRow { chatId: string; lang: string; createdAt: Date; remindedAt: Date | null }

// Кому слать напоминание и кого пометить. Привязанный чат (уже есть аккаунт с этим Telegram) —
// человек поставил расширение: не пишем, но помечаем, чтобы больше не выбирать.
export function decideReminders(leads: LeadRow[], linked: Set<string>, now: number) {
  const send: { chatId: string; lang: InstallLang }[] = [];
  const mark: string[] = [];
  for (const l of leads) {
    const age = now - new Date(l.createdAt).getTime();
    if (l.remindedAt || age < REMIND_AFTER_MS || age >= REMIND_WINDOW_MS) continue;
    mark.push(l.chatId);
    if (!linked.has(l.chatId)) send.push({ chatId: l.chatId, lang: normalizeLang(l.lang) });
  }
  return { send, mark };
}
```

- [ ] **Step 4: Service** — `backend/src/telegram/install-reminders.service.ts`

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Cron } from '@nestjs/schedule';
import { Op } from 'sequelize';
import { User } from '../users/user.model';
import { InstallLead } from './install-lead.model';
import { TelegramService } from './telegram.service';
import { decideReminders, installReminderText, LEAD_TTL_MS, REMIND_WINDOW_MS } from './install';

// Раз в час: одно напоминание тем, кто сутки назад попросил у бота ссылку на установку, и чистка заявок >30 дней.
// reminded_at ставим даже при ошибке отправки — заблокировавшего бота не опрашиваем каждый час.
@Injectable()
export class InstallRemindersService {
  private readonly log = new Logger(InstallRemindersService.name);

  constructor(
    @InjectModel(InstallLead) private readonly leads: typeof InstallLead,
    @InjectModel(User) private readonly users: typeof User,
    private readonly telegram: TelegramService,
  ) {}

  @Cron('0 * * * *')
  async tick(): Promise<void> {
    try { await this.run(); }
    catch (e) { this.log.error(`install reminders failed: ${(e as Error).message}`); }
  }

  async run(now = Date.now()): Promise<{ sent: number; skipped: number; deleted: number }> {
    const deleted = await this.leads.destroy({ where: { createdAt: { [Op.lt]: new Date(now - LEAD_TTL_MS) } } });
    const rows = await this.leads.findAll({
      where: { remindedAt: null, createdAt: { [Op.gt]: new Date(now - REMIND_WINDOW_MS) } },
    });
    if (!rows.length) return { sent: 0, skipped: 0, deleted };
    const linkedRows = await this.users.findAll({
      where: { telegramChatId: { [Op.in]: rows.map((r) => r.chatId) } }, attributes: ['telegramChatId'],
    });
    const linked = new Set(linkedRows.map((u) => String(u.telegramChatId)));
    const { send, mark } = decideReminders(rows, linked, now);
    let sent = 0;
    for (const s of send) {
      const ok = await this.telegram.sendMessageTo(s.chatId, installReminderText(s.lang)).catch(() => false);
      if (ok) sent++;
    }
    for (const chatId of mark) await this.leads.update({ remindedAt: new Date(now) }, { where: { chatId } });
    return { sent, skipped: mark.length - send.length, deleted };
  }
}
```

Register in `telegram.module.ts`: `providers: [TelegramService, InstallRemindersService, JwtAuthGuard, ProGuard]` (import it).

- [ ] **Step 5:** `cd backend && npx jest && npm run build` → PASS.
- [ ] **Step 6: Privacy** — in `backend/public/privacy.html`, after the `<tr>` whose first cell starts with `<strong>Telegram</strong> (only if you link it)`, insert:

```html
      <tr>
        <td><strong>Install link from our Telegram bot</strong> (only if you ask the bot for it) — your Telegram chat ID
          and the page language</td>
        <td>Sending you the link to install LoadLens on your computer and one reminder the next day. Deleted after
          30 days.</td>
      </tr>
```

And append to `scripts/landing-i18n.test.js`:

```js
test("privacy: заявка на ссылку установки из бота и срок хранения 30 дней", () => {
  const privacy = fs.readFileSync(path.join(PUB, "privacy.html"), "utf8");
  assert.match(privacy, /Install link from our Telegram bot/);
  assert.match(privacy, /Deleted after\s+30 days/);
});
```

- [ ] **Step 7:** `npm test` (root) → PASS.
- [ ] **Step 8: Commit** `git add backend/src backend/public/privacy.html scripts/landing-i18n.test.js && git commit -m "feat(telegram): одно напоминание об установке через сутки, privacy"`

---

### Task 9: Mobile e2e (full)

**Files:** Modify `scripts/mobile-site.e2e.py`

**Interfaces:** Consumes everything above; ids/classes from Tasks 3–5.

- [ ] **Step 1: Extend the script** — add these functions and call them in `__main__` after `no_hscroll`:

```python
def landing_mobile(p, base):
    b = p.chromium.launch(); ctx = b.new_context(**p.devices["iPhone 13"], locale="en-US")
    pg = ctx.new_page(); pg.goto(base + "/", wait_until="domcontentloaded")
    check(pg.locator('[data-cws="hero"]').is_hidden(), "телефон: Add to Chrome скрыт")
    check(pg.locator('[data-share="hero"]').is_visible(), "телефон: Send me the link виден")
    check(pg.locator('[data-tg="hero"]').is_visible(), "телефон: Telegram виден")
    h = pg.locator("#consent").bounding_box()["height"]
    check(h <= 80, f"телефон: баннер cookies ≤ 80px ({h:.0f})")
    check("consent-open" in pg.evaluate("document.documentElement.className"), "consent-open при видимом баннере")
    pg.click("#ck-no")
    check("consent-open" not in pg.evaluate("document.documentElement.className"), "consent-open снят после Decline")
    b.close()

def landing_desktop(p, base):
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1280, "height": 900}, locale="en-US")
    pg = ctx.new_page(); pg.goto(base + "/", wait_until="domcontentloaded")
    check(pg.locator('[data-cws="hero"]').is_visible(), "десктоп: Add to Chrome виден")
    check(pg.locator('[data-share="hero"]').is_hidden(), "десктоп: Send me the link скрыт")
    b.close()

def calc_mobile(p, base):
    b = p.chromium.launch(); ctx = b.new_context(**p.devices["iPhone 13"], locale="en-US")
    pg = ctx.new_page(); pg.goto(base + "/hos-calculator/", wait_until="load")
    pg.click("#ck-no")
    check(pg.locator("#hos-bar").is_visible(), "калькулятор: плашка видна, пока Time left за экраном")
    # 10h30 за рулём, смена 11h, перерыв был 2h назад → до 11h осталось 30 мин (тесный лимит), остальные шире
    pg.fill("#driven-h", "10"); pg.fill("#driven-m", "30"); pg.fill("#shift-h", "11"); pg.fill("#since-h", "2")
    check(pg.locator("#hos-bar").get_attribute("class") == "hos-bar warn", "калькулятор: 30 минут — янтарная плашка")
    check("30m" in pg.locator("#hos-bar-text").inner_text(), "калькулятор: текст плашки = ответ")
    pg.click("#hos-bar"); pg.wait_for_timeout(800)
    check(pg.locator("#hos-bar").is_hidden(), "калькулятор: после тапа Time left на экране, плашка скрыта")
    pg.reload(wait_until="load")
    check(pg.input_value("#driven-h") == "10", "калькулятор: ввод пережил перезагрузку")
    pg.click("#reset")
    check(pg.input_value("#driven-h") == "0", "калькулятор: Reset вернул значения по умолчанию")
    pg.evaluate("navigator.serviceWorker.ready.then(() => true)")
    pg.reload(wait_until="load")   # страница под контролем SW
    ctx.set_offline(True)
    pg.reload(wait_until="load")
    check(pg.locator("#calc").is_visible(), "калькулятор: открывается без сети")
    ctx.set_offline(False)
    b.close()
```

`__main__` body becomes:

```python
    with sync_playwright() as p:
        no_hscroll(p, base)
        landing_mobile(p, base)
        landing_desktop(p, base)
        calc_mobile(p, base)
```

- [ ] **Step 2:** `npm run e2e:mobile` → `0 fail(s)`. If the offline step is flaky, add `pg.wait_for_function("navigator.serviceWorker.controller !== null")` before `set_offline` — do not weaken the assertion.
- [ ] **Step 3: Screenshots for the founder** — add at the end of `calc_mobile` and `landing_mobile` (before `b.close()`): `pg.screenshot(path=os.environ.get("SHOTS", "/tmp") + "/<name>.png")` with names `landing-mobile`, `calc-mobile`; run with `SHOTS=<scratchpad>` and look at them with the Read tool.
- [ ] **Step 4: Commit** `git add scripts/mobile-site.e2e.py && git commit -m "test(site): e2e мобильного сайта — кнопки, баннер, плашка, офлайн"`

---

### Task 10: Docs, merge, deploy, live check

**Files:** Modify `CLAUDE.md` (structure section), `CHANGELOG.md` if the site section exists there (check with `grep -n "Unreleased" CHANGELOG.md`).

- [ ] **Step 1: CLAUDE.md** — in the `backend/public/` structure line add: `sw.js (кэш только калькулятора) + js/hos-mobile.js (LLHOSM: плашка/запоминание) + js/hos-pwa.js (A2HS); манифесты калькулятора генерит build:landing; на телефоне (is-mobile в <head>) вместо Add to Chrome — data-share / data-tg → GET /telegram/install (302 на бота)`; in the `telegram/` line add `+ install (302 на бота) + /start install_<lang> → install_leads, одно напоминание через сутки (InstallRemindersService)`; under Команды add `npm run e2e:mobile`.
- [ ] **Step 2: Full verification** — root `npm test`, `cd backend && npx jest && npm run build`, `npm run e2e:mobile`. All PASS. Paste the summary lines into the task file `tasks/0059-mobile-site.md`.
- [ ] **Step 3: Commit** `git commit -am "docs: сайт под телефон в CLAUDE.md"`
- [ ] **Step 4: Merge** — `cd /Users/bogdan/work/startup/dat.com && git fetch -q && git merge --ff-only mobile-site` (if main moved: in the worktree `git rebase main`, rerun Step 2, retry). Ask the founder before `git push origin main` (push = autodeploy).
- [ ] **Step 5: After deploy** — `curl -sI https://loadlens.krait.studio/api/v1/telegram/install?lang=ru | grep -i location` → `https://t.me/<bot>?start=install_ru`; `curl -s https://loadlens.krait.studio/ru/hos-calculator/manifest.webmanifest` → JSON with `"lang": "ru"`; `curl -sI https://loadlens.krait.studio/sw.js` → 200 `javascript`. Ask the founder to open the site on their phone: Send me the link, Telegram (bot replies in RU/EN), calculator bar, Add to Home Screen.
- [ ] **Step 6: Note for the Paddle branch** — `paddle-live-texts` (worktree `../dat.com-paddle-live`) edits the pricing card in `index.html` (adds a `data-cws="pricing-pro"` button). After this lands, rebase it: the new Pro button needs ` cta-desktop` and the same `cta-mobile` block with `place=pricing-pro`, and the test `places(html, "data-share")` must include `pricing-pro`. Record this in memory (`loadlens-payments-moldova.md`).
- [ ] **Step 7:** Update `tasks/0059-mobile-site.md` checkboxes, remove the worktree (`git worktree remove ../dat.com-mobile && git branch -d mobile-site`).
