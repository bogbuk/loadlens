/* LoadLens API client + анонимный clientId + JWT-аккаунт. Грузится перед content.js.
   Аналог PriceLens PLAPI. PII (контакты/телефоны) режется в sanitizeLoad перед отправкой. */
const LLAPI = (() => {
  "use strict";
  const BASE = (globalThis.LL_BACKEND || "https://loadlens.krait.studio") + "/api/v1";

  // Whitelist полей груза, уходящих на сервер. contact/телефоны/имена диспетчеров — НЕ входят.
  const SAFE_FIELDS = [
    "board", "loadId", "originMarket", "destMarket", "equipment", "groupKey",
    "rate", "loadedMiles", "deadheadMiles", "weight", "brokerMc", "brokerName",
  ];
  // грубый детектор личного контакта в имени брокера — такие поля обнуляем
  const PII_RE = /(\+?\d[\d\s().-]{6,}\d)|@|whatsapp|telegram|viber/i;

  function sanitizeLoad(load) {
    const out = {};
    for (const k of SAFE_FIELDS) if (load[k] != null) out[k] = load[k];
    if (out.brokerName && PII_RE.test(out.brokerName)) delete out.brokerName;
    // board/markets/equipment/groupKey обязательны
    if (!out.board || !out.originMarket || !out.destMarket || !out.equipment || !out.groupKey) return null;
    return out;
  }

  async function clientId() {
    const { ll_cid } = await chrome.storage.local.get("ll_cid");
    if (ll_cid) return ll_cid;
    const id = crypto.randomUUID();
    await chrome.storage.local.set({ ll_cid: id });
    return id;
  }

  async function sendLoads(loads) {
    const clean = loads.map(sanitizeLoad).filter(Boolean).slice(0, 200);
    if (!clean.length) return { accepted: 0 };
    try {
      const cid = await clientId();
      const res = await fetch(`${BASE}/loads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: cid, items: clean }),
      });
      return res.ok ? res.json() : { accepted: 0 };
    } catch { return { accepted: 0 }; }
  }

  async function getLane(origin, dest, equipment) {
    try {
      const q = equipment ? `?equipment=${encodeURIComponent(equipment)}` : "";
      const res = await fetch(`${BASE}/lanes/${encodeURIComponent(origin)}/${encodeURIComponent(dest)}${q}`, { headers: await authHeader() });
      return res.ok ? res.json() : null;
    } catch { return null; }
  }

  // крауд-грузы из рынка отправления — для onward-плеч планировщика цепочек
  async function getLoadsByOrigin(market, equipment) {
    try {
      const q = equipment ? `&equipment=${encodeURIComponent(equipment)}` : "";
      const res = await fetch(`${BASE}/loads?origin=${encodeURIComponent(market)}${q}`, { headers: await authHeader() });
      return res.ok ? res.json() : [];
    } catch { return []; }
  }

  // neighborhood грузов (рынок + соседи) + delta(since) для живого монитора цепочек
  async function getLoadsNear(market, { equipment, since } = {}) {
    try {
      const q = new URLSearchParams({ market });
      if (equipment) q.set("equipment", equipment);
      if (since) q.set("since", since);
      const res = await fetch(`${BASE}/loads/near?${q.toString()}`, { headers: await authHeader() });
      return res.ok ? res.json() : null;
    } catch { return null; }
  }

  async function getBrokerReputation(mc) {
    try {
      const res = await fetch(`${BASE}/brokers/${encodeURIComponent(mc)}/reputation`, { headers: await authHeader() });
      return res.ok ? res.json() : null;
    } catch { return null; }
  }

  async function reportBroker(brokerMc, outcome, note) {
    try {
      const cid = await clientId();
      const res = await fetch(`${BASE}/brokers/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: cid, brokerMc, outcome, note: note || undefined }),
      });
      return res.ok;
    } catch { return false; }
  }

  async function getMarket(market) {
    try {
      const res = await fetch(`${BASE}/markets/${encodeURIComponent(market)}/strength`, { headers: await authHeader() });
      return res.ok ? res.json() : null;
    } catch { return null; }
  }

  async function getDistance(from, to) {
    try {
      const res = await fetch(`${BASE}/geo/distance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: await authHeader() });
      return res.ok ? res.json() : null;
    } catch { return null; }
  }

  const FALLBACK_DIESEL = 3.95;
  let _diesel = null, _dieselTs = 0;
  const DIESEL_TTL = 6 * 60 * 60 * 1000;
  async function getDiesel() {
    const now = Date.now();
    if (_diesel && now - _dieselTs < DIESEL_TTL) return _diesel;
    try {
      const { ll_diesel } = await chrome.storage.local.get("ll_diesel");
      if (ll_diesel && now - ll_diesel.ts < DIESEL_TTL) { _diesel = ll_diesel.price; _dieselTs = ll_diesel.ts; return _diesel; }
      const res = await fetch(`${BASE}/rates`, { headers: await authHeader() });
      if (!res.ok) throw new Error("bad");
      const data = await res.json();
      const price = data && data.dieselPrice ? data.dieselPrice : FALLBACK_DIESEL;
      if (!data.stale) { _diesel = price; _dieselTs = now; await chrome.storage.local.set({ ll_diesel: { price, ts: now } }); }
      return price;
    } catch { _diesel = _diesel || FALLBACK_DIESEL; return _diesel; }
  }

  // ---- аккаунт: токены и план в chrome.storage.local.ll_auth (копия PLAPI) ----
  const PLAN_TTL = 24 * 60 * 60 * 1000;
  async function getAuth() { return (await chrome.storage.local.get("ll_auth")).ll_auth || null; }
  async function setAuth(a) { await chrome.storage.local.set({ ll_auth: a }); }
  async function logout() { await chrome.storage.local.remove("ll_auth"); }

  // Bearer для read-вызовов: Premium-чтение требует Pro-JWT. Не залогинен → пустой заголовок → 403 → фолбэк.
  async function authHeader() {
    const a = await getAuth();
    return a && a.accessToken ? { Authorization: `Bearer ${a.accessToken}` } : {};
  }

  async function credsCall(path, email, password) {
    const res = await fetch(`${BASE}/auth/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `ошибка ${res.status}`);
    await setAuth({ accessToken: data.accessToken, refreshToken: data.refreshToken,
                    email: data.user.email, plan: data.user.plan, planTs: Date.now() });
    return data.user;
  }
  const register = (email, password) => credsCall("register", email, password);
  const login = (email, password) => credsCall("login", email, password);

  async function refreshTokens(auth) {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: auth.refreshToken }),
    });
    if (!res.ok) { await logout(); return null; }
    const data = await res.json();
    const next = { ...auth, accessToken: data.accessToken, refreshToken: data.refreshToken };
    await setAuth(next);
    return next;
  }

  async function getMe(force) {
    let auth = await getAuth();
    if (!auth) return null;
    if (!force && auth.planTs && Date.now() - auth.planTs < PLAN_TTL)
      return { email: auth.email, plan: auth.plan };
    try {
      let res = await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${auth.accessToken}` } });
      if (res.status === 401) {
        auth = await refreshTokens(auth);
        if (!auth) return null;
        res = await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${auth.accessToken}` } });
      }
      if (!res.ok) return { email: auth.email, plan: auth.plan };
      const user = await res.json();
      await setAuth({ ...auth, email: user.email, plan: user.plan, planTs: Date.now() });
      return user;
    } catch { return { email: auth.email, plan: auth.plan }; }
  }

  // ---- authed fetch с авто-refresh (как getMe). Возвращает Response или null (не залогинен). ----
  async function authedFetch(path, opts = {}) {
    let auth = await getAuth();
    if (!auth) return null;
    const call = (a) => fetch(`${BASE}${path}`, {
      ...opts,
      headers: { ...(opts.headers || {}), "Content-Type": "application/json", Authorization: `Bearer ${a.accessToken}` },
    });
    try {
      let res = await call(auth);
      if (res.status === 401) {
        auth = await refreshTokens(auth);
        if (!auth) return null;
        res = await call(auth);
      }
      return res;
    } catch { throw new Error("сетевая ошибка"); }
  }

  // ---- парк водителей (под JWT диспетчера) ----
  async function getDrivers() {
    try { const res = await authedFetch("/drivers"); return res && res.ok ? await res.json() : []; }
    catch { return []; }
  }
  async function createDriver(d) {
    const res = await authedFetch("/drivers", { method: "POST", body: JSON.stringify(d) });
    if (!res) throw new Error("нужен вход в аккаунт");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `ошибка ${res.status}`);
    return data;
  }
  async function updateDriver(id, patch) {
    const res = await authedFetch(`/drivers/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    if (!res) throw new Error("нужен вход в аккаунт");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `ошибка ${res.status}`);
    return data;
  }
  async function deleteDriver(id) {
    const res = await authedFetch(`/drivers/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res) throw new Error("нужен вход в аккаунт");
    if (!res.ok) throw new Error(`ошибка ${res.status}`);
    return { ok: true };
  }

  // ---- Telegram-алерты (под JWT диспетчера; link/alerts Pro-гейт на сервере) ----
  async function telegramStatus() {
    try { const res = await authedFetch("/telegram/status"); return res && res.ok ? await res.json() : null; }
    catch { return null; }
  }
  async function telegramLink() {
    const res = await authedFetch("/telegram/link", { method: "POST" });
    if (!res) throw new Error("нужен вход в аккаунт");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `ошибка ${res.status}`);
    return data; // { url, token, configured }
  }
  async function telegramAlerts(enabled) {
    const res = await authedFetch("/telegram/alerts", { method: "PATCH", body: JSON.stringify({ enabled }) });
    if (!res) throw new Error("нужен вход в аккаунт");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `ошибка ${res.status}`);
    return data;
  }
  async function telegramUnlink() {
    const res = await authedFetch("/telegram/unlink", { method: "POST" });
    if (!res) throw new Error("нужен вход в аккаунт");
    if (!res.ok) throw new Error(`ошибка ${res.status}`);
    return { ok: true };
  }
  // Релей подошедших грузов (green+фильтр) в Telegram. Тихо глотает ошибки — это фоновый канал.
  async function notifyAlerts(items) {
    try {
      const res = await authedFetch("/telegram/notify", { method: "POST", body: JSON.stringify({ items }) });
      return res && res.ok ? await res.json() : null;
    } catch { return null; }
  }

  // Удаление аккаунта (hard-delete на сервере; водители уходят каскадом). Затем локальный logout.
  async function deleteAccount() {
    const res = await authedFetch("/users/me", { method: "DELETE" });
    if (!res || !res.ok) throw new Error(res ? `ошибка ${res.status}` : "нужен вход в аккаунт");
    await logout();
    return { ok: true };
  }

  // Смена своего пароля. Серверное сообщение об ошибке (400 — неверный текущий / новый = старый) пробрасываем как есть.
  async function changePassword(currentPassword, newPassword) {
    const res = await authedFetch("/users/me/password", {
      method: "PATCH",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!res || !res.ok) {
      const msg = res ? ((await res.json().catch(() => ({}))).message || `ошибка ${res.status}`) : "нужен вход в аккаунт";
      throw new Error(Array.isArray(msg) ? msg.join(", ") : msg);
    }
    return { ok: true };
  }

  async function forgotPassword(email) {
    const res = await fetch(`${BASE}/auth/forgot`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || `ошибка ${res.status}`); }
    return { ok: true };
  }

  async function resetPassword(token, newPassword) {
    const res = await fetch(`${BASE}/auth/reset`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      const m = d.message || `ошибка ${res.status}`;
      throw new Error(Array.isArray(m) ? m.join(", ") : m);
    }
    return { ok: true };
  }

  return { sanitizeLoad, clientId, sendLoads, getLane, getMarket, getDistance, getDiesel,
           getLoadsByOrigin, getLoadsNear, getBrokerReputation, reportBroker, register, login, logout, getMe,
           getDrivers, createDriver, updateDriver, deleteDriver, deleteAccount, changePassword, forgotPassword, resetPassword,
           telegramStatus, telegramLink, telegramAlerts, telegramUnlink, notifyAlerts };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLAPI; }
if (typeof globalThis !== "undefined") globalThis.LLAPI = LLAPI;
