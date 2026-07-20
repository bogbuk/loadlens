/* LoadLens popup — настройки водителя (cost/mile + HOS-часы) и аккаунт (JWT, план). */
const escA = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---- настройки ----
const setEl = document.getElementById("settings");
// канон типов трейлеров (коды DAT One + legacy) — единый источник из vendor/load.model.js
const EQUIP_TYPES = (typeof LLMODEL !== "undefined" && LLMODEL.EQUIP_TYPES)
  || [{ code: "V", label: "Van" }, { code: "R", label: "Reefer" }, { code: "F", label: "Flatbed" }];
const equipOption = (e, sel) =>
  `<option value="${e.code}"${sel === e.code ? " selected" : ""}>${escA(e.label)} (${e.code})</option>`;
const DEFAULT_TARGETS = (typeof LLSCORE !== "undefined" && LLSCORE.DEFAULTS.targets)
  || [{ maxMi: 500, rpm: 7.0 }, { maxMi: 1000, rpm: 6.0 }, { maxMi: null, rpm: 5.0 }];

// поля сортировки (зеркало content.js SORT_FIELDS) — наш контрол не хардкодит точные метки DAT
const SORT_FIELDS = [
  { field: "rate", label: "Rate" },
  { field: "age", label: "Age" },
  { field: "trip", label: "Trip miles" },
  { field: "deadhead", label: "Deadhead" },
];

async function renderSettings() {
  const { ll_cpm, ll_targets, ll_equip_filter, ll_autorefresh, ll_sort, ll_hide_panel, ll_hide_badges } =
    await chrome.storage.local.get(["ll_cpm", "ll_targets", "ll_equip_filter", "ll_autorefresh", "ll_sort", "ll_hide_panel", "ll_hide_badges"]);
  const cpm = ll_cpm != null ? ll_cpm : 1.80;
  const targets = Array.isArray(ll_targets) && ll_targets.length ? ll_targets : DEFAULT_TARGETS;
  const ar = (ll_autorefresh && typeof ll_autorefresh === "object") ? ll_autorefresh : { on: false, intervalMs: 60000 };
  const sort = (ll_sort && ll_sort.field) ? { field: ll_sort.field, dir: ll_sort.dir === "asc" ? "asc" : "desc" } : { field: "", dir: "desc" };
  const equipSel = new Set(LLEQUIP.normalize(ll_equip_filter) || []);
  const hos = await LLHOS.load();
  setEl.innerHTML =
    '<h4>Driver settings</h4>' +
    settingRow("Cost / mile, $", "s-cpm", cpm, 0.05) +
    settingRow("Drive left, h", "s-drive", round1(hos.remainingDrive / 60), 0.5) +
    settingRow("Duty left, h", "s-duty", round1(hos.remainingOnDuty / 60), 0.5) +
    settingRow("Cycle left, h", "s-cycle", round1(hos.remainingCycle / 60), 1) +
    '<h4>Target rates by distance</h4>' +
    targets.map(targetRow).join("") +
    '<h4>Equipment filter</h4>' +
    `<div class="chips" id="s-equip">` +
    EQUIP_TYPES.map((e) =>
      `<button type="button" class="chip${equipSel.has(e.code) ? " on" : ""}" data-code="${escA(e.code)}" title="${escA(e.label)}">${escA(e.code)}</button>`).join("") +
    '</div>' +
    '<div class="chips-bar"><span class="note" id="s-equip-sum"></span>' +
    '<span class="chips-actions"><button type="button" class="linkbtn" id="s-equip-all">All</button> · ' +
    '<button type="button" class="linkbtn" id="s-equip-none">Clear</button></span></div>' +
    '<h4>DAT tab auto-pilot</h4>' +
    `<div class="row"><span class="k">Interval, sec (≥60)</span><input id="s-ar-int" type="number" min="60" step="10" value="${Math.round((ar.intervalMs || 60000) / 1000)}"></div>` +
    `<div class="row"><span class="k">Auto-scroll (pull all pages)</span><input id="s-ar-scroll" type="checkbox"${ar.autoscroll !== false ? " checked" : ""} style="width:auto"></div>` +
    `<div class="row"><span class="k">Sort</span><select id="s-sort-f">` +
    ['<option value="">— keep current —</option>'].concat(SORT_FIELDS.map((s) =>
      `<option value="${s.field}"${sort.field === s.field ? " selected" : ""}>${escA(s.label)}</option>`)).join("") +
    `</select></div>` +
    `<div class="row"><span class="k">Direction</span><select id="s-sort-d">` +
    `<option value="desc"${sort.dir === "desc" ? " selected" : ""}>Highest → Lowest</option>` +
    `<option value="asc"${sort.dir === "asc" ? " selected" : ""}>Lowest → Highest</option></select></div>` +
    '<h4>On-page display</h4>' +
    `<div class="row"><span class="k">Hide panel on page</span><input id="s-hide-panel" type="checkbox"${ll_hide_panel ? " checked" : ""} style="width:auto"></div>` +
    `<div class="row"><span class="k">Hide badges in table</span><input id="s-hide-badges" type="checkbox"${ll_hide_badges ? " checked" : ""} style="width:auto"></div>` +
    '<button id="s-save">Save</button>' +
    '<div class="note">Target $/mi is the "profitable" (green) threshold: a load is green when its gross $/mile is at or above the target for its distance bucket. Cost/mile is the break-even line below which a load is a loss (red).</div>' +
    '<div class="note">"On-page display" applies instantly to all DAT/Truckstop tabs — no need to press Save.</div>' +
    '<div class="note">Auto-pilot is switched on per DAT results tab (the "Auto-refresh" toggle in the panel header). Set here: the shared interval (60–120s with jitter), the sort order to hold, and auto-scroll (scrolls the results so DAT loads every page; the panel accumulates them by searchId).</div>';
  document.getElementById("s-save").onclick = save;
  wireEquipChips();
  // «Отображение на странице» — instant-apply (без кнопки «Сохранить»); content.js слушает storage.onChanged
  document.getElementById("s-hide-panel").onchange = (e) => chrome.storage.local.set({ ll_hide_panel: e.target.checked });
  document.getElementById("s-hide-badges").onchange = (e) => chrome.storage.local.set({ ll_hide_badges: e.target.checked });
}
// чипы-тумблеры фильтра прицепа: клик переключает .on, ссылки Все/Сброс, живая сводка
function wireEquipChips() {
  const wrap = document.getElementById("s-equip");
  const sum = document.getElementById("s-equip-sum");
  const refresh = () => {
    const on = [...wrap.querySelectorAll(".chip.on")].map((c) => c.dataset.code);
    sum.textContent = on.length ? "Only: " + on.join(", ") : "All equipment types shown";
  };
  wrap.querySelectorAll(".chip").forEach((c) => {
    c.onclick = () => { c.classList.toggle("on"); refresh(); };
  });
  const setAll = (on) => { wrap.querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", on)); refresh(); };
  document.getElementById("s-equip-all").onclick = () => setAll(true);
  document.getElementById("s-equip-none").onclick = () => setAll(false);
  refresh();
}
function settingRow(label, id, val, step) {
  return `<div class="row"><span class="k">${label}</span>` +
    `<input id="${id}" type="number" step="${step}" min="0" value="${val}"></div>`;
}
// строка бакета: для overflow (maxMi==null) — метка «N+ mi», иначе редактируемая верхняя граница миль.
function targetRow(t, i, arr) {
  const isLast = t.maxMi == null;
  const prevMax = i > 0 ? arr[i - 1].maxMi : 0;
  const label = isLast
    ? `<span class="k">${prevMax || 0}+ mi</span>`
    : `<span class="k">≤ <input id="t-max-${i}" type="number" step="50" min="1" value="${t.maxMi}" style="width:56px"> mi</span>`;
  return `<div class="row">${label}` +
    `<span>$<input id="t-rpm-${i}" type="number" step="0.05" min="0" value="${t.rpm}" style="width:56px">/mi</span></div>`;
}
async function save() {
  const cpm = parseFloat(document.getElementById("s-cpm").value);
  const driveH = parseFloat(document.getElementById("s-drive").value);
  const dutyH = parseFloat(document.getElementById("s-duty").value);
  const cycleH = parseFloat(document.getElementById("s-cycle").value);
  if (cpm > 0) await chrome.storage.local.set({ ll_cpm: cpm });
  const equipCodes = [...document.querySelectorAll("#s-equip .chip.on")].map((c) => c.dataset.code);
  await chrome.storage.local.set({ ll_targets: readTargets(), ll_equip_filter: LLEQUIP.normalize(equipCodes) });
  // авто-пилот: интервал не реже 60с; сорт = поле+направление (пусто → не удерживать)
  const intSec = Math.max(60, parseInt(document.getElementById("s-ar-int").value, 10) || 60);
  const autoscroll = document.getElementById("s-ar-scroll").checked;
  const sortField = document.getElementById("s-sort-f").value || null;
  await chrome.storage.local.set({
    // on — per-tab (sessionStorage в content.js), попап хранит интервал + авто-скролл
    ll_autorefresh: { intervalMs: intSec * 1000, autoscroll },
    ll_sort: sortField ? { field: sortField, dir: document.getElementById("s-sort-d").value === "asc" ? "asc" : "desc" } : { field: null },
  });
  await LLHOS.save(LLHOS.fromHours({ driveH, dutyH, cycleH }));
  const btn = document.getElementById("s-save");
  btn.textContent = "Saved ✓";
  setTimeout(() => { btn.textContent = "Save"; }, 1200);
}
// собирает таблицу бакетов из инпутов: верхняя граница (overflow = null) + целевой $/mi.
function readTargets() {
  const rows = [];
  for (let i = 0; ; i++) {
    const rpmEl = document.getElementById(`t-rpm-${i}`);
    if (!rpmEl) break;
    const maxEl = document.getElementById(`t-max-${i}`);
    const rpm = parseFloat(rpmEl.value);
    rows.push({ maxMi: maxEl ? parseInt(maxEl.value, 10) : null, rpm: isNaN(rpm) ? 0 : rpm });
  }
  return rows;
}
const round1 = (n) => Math.round(n * 10) / 10;

// ---- аккаунт (копия паттерна PriceLens) ----
const accEl = document.getElementById("account");
function accRow(user) {
  accEl.innerHTML = '<div class="acc"><div class="who"><span>' + escA(user.email) +
    '</span><span class="plan ' + (user.plan === "pro" ? "pro" : "") + '">' +
    (user.plan === "pro" ? "PRO" : "FREE") + "</span></div>" +
    '<button id="acc-pwd-btn">Change password</button>' +
    '<div id="acc-pwd"></div>' +
    '<button id="acc-out">Sign out</button>' +
    '<button id="acc-del" class="danger">Delete account</button></div>';
  document.getElementById("acc-pwd-btn").onclick = () => pwdForm(document.getElementById("acc-pwd"));
  document.getElementById("acc-out").onclick = async () => { await LLAPI.logout(); accForm(); renderFleet(null); renderTelegram(null); };
  document.getElementById("acc-del").onclick = async () => {
    if (!confirm("Delete your account permanently? Your profile and all drivers will be removed. This does not cancel your DAT/Truckstop subscription.")) return;
    try { await LLAPI.deleteAccount(); accForm("Account deleted."); renderFleet(null); renderTelegram(null); }
    catch (e) { accForm(e.message); }
  };
}
function accForm(err) {
  accEl.innerHTML = '<div class="acc"><h4>Account</h4>' +
    '<input id="acc-email" type="email" placeholder="email" autocomplete="username">' +
    '<input id="acc-pass" type="password" placeholder="password (min. 8)" autocomplete="current-password">' +
    '<div class="err">' + escA(err || "") + "</div>" +
    '<div class="btns"><button id="acc-in">Sign in</button><button id="acc-reg">Sign up</button></div>' +
    '<div class="note"><button id="acc-forgot" class="linkbtn">Forgot password?</button></div>' +
    '<div class="note">Pro: full 3-leg get-out chains + CSV load export.</div></div>';
  const go = (fn) => async () => {
    const email = document.getElementById("acc-email").value.trim();
    const pass = document.getElementById("acc-pass").value;
    try { const u = await fn(email, pass); accRow(u); renderFleet(u); renderTelegram(u); }
    catch (e) { accForm(e.message); }
  };
  document.getElementById("acc-in").onclick = go(LLAPI.login);
  document.getElementById("acc-reg").onclick = go(LLAPI.register);
  document.getElementById("acc-forgot").onclick = () => resetForm(document.getElementById("acc-email").value.trim());
}

// Шаг 1 сброса: ввод email → запрос кода. Контент статический.
function resetForm(prefillEmail) {
  accEl.innerHTML = '<div class="acc"><h4>Password reset</h4>' +
    '<input id="rst-email" type="email" placeholder="email" autocomplete="username">' +
    '<div class="err" id="rst-err"></div>' +
    '<div class="btns"><button id="rst-send">Send code</button><button id="rst-cancel">Back</button></div>' +
    '<div class="note">If your account is linked to Telegram, the code will arrive in the bot.</div></div>';
  document.getElementById("rst-email").value = prefillEmail || "";
  document.getElementById("rst-cancel").onclick = () => accForm();
  document.getElementById("rst-send").onclick = async () => {
    const email = document.getElementById("rst-email").value.trim();
    const err = document.getElementById("rst-err");
    if (!email) { err.textContent = "enter your email"; return; }
    err.textContent = "";
    try { await LLAPI.forgotPassword(email); resetCodeForm(email); }
    catch (e) { err.textContent = e.message; }
  };
}

// Шаг 2 сброса: код из Telegram + новый пароль.
function resetCodeForm(email) {
  accEl.innerHTML = '<div class="acc"><h4>Enter code</h4>' +
    '<input id="rst-code" type="text" placeholder="code from Telegram" autocomplete="one-time-code">' +
    '<input id="rst-new" type="password" placeholder="new password (min. 8)" autocomplete="new-password">' +
    '<div class="err" id="rst-err2"></div>' +
    '<div class="btns"><button id="rst-do">Reset</button><button id="rst-back">Back</button></div></div>';
  document.getElementById("rst-back").onclick = () => resetForm(email);
  document.getElementById("rst-do").onclick = async () => {
    const code = document.getElementById("rst-code").value.trim();
    const neu = document.getElementById("rst-new").value;
    const err = document.getElementById("rst-err2");
    if (!code) { err.textContent = "enter the code"; return; }
    if (neu.length < 8) { err.textContent = "minimum 8 characters"; return; }
    err.textContent = "";
    try { await LLAPI.resetPassword(code, neu); accForm("Password reset — please sign in."); }
    catch (e) { err.textContent = e.message; }
  };
}

// Инлайн-форма смены пароля (toggle внутри секции аккаунта). Контент статический — без подстановки данных юзера.
function pwdForm(box) {
  if (box.dataset.open === "1") { box.dataset.open = "0"; box.innerHTML = ""; return; }
  box.dataset.open = "1";
  box.innerHTML =
    '<input id="acc-cur" type="password" placeholder="current password" autocomplete="current-password">' +
    '<input id="acc-new" type="password" placeholder="new password (min. 8)" autocomplete="new-password">' +
    '<div class="err" id="acc-pwd-err"></div>' +
    '<div class="btns"><button id="acc-pwd-save">Save</button></div>';
  document.getElementById("acc-pwd-save").onclick = async () => {
    const cur = document.getElementById("acc-cur").value;
    const neu = document.getElementById("acc-new").value;
    const err = document.getElementById("acc-pwd-err");
    if (cur.length < 8 || neu.length < 8) { err.textContent = "minimum 8 characters"; return; }
    err.textContent = "";
    try {
      await LLAPI.changePassword(cur, neu);
      // Смена пароля инвалидирует все сессии (включая текущую) — выходим и просим войти заново.
      await LLAPI.logout();
      accForm("Password changed — please sign in again.");
      renderFleet(null); renderTelegram(null);
    } catch (e) { err.textContent = e.message; }
  };
}

// ---- парк водителей (виден залогиненному диспетчеру) ----
const fleetEl = document.getElementById("fleet");

async function renderFleet(me) {
  if (me === undefined) me = await LLAPI.getMe().catch(() => null);
  if (!me) { fleetEl.innerHTML = '<h4>Fleet</h4><div class="note">Sign in to manage your drivers.</div>'; return; }
  if (me.plan !== "pro") { fleetEl.innerHTML = '<h4>Fleet <span class="plan pro">PRO</span></h4><div class="note">Fleet and match-all-drivers are Pro features.</div>'; return; }
  let list = [];
  try { list = await LLAPI.getDrivers(); } catch { list = []; }
  fleetEl.innerHTML = '<h4>Fleet</h4>' +
    (list.length ? list.map(driverRow).join("") : '<div class="note">No drivers yet — add your first one.</div>') +
    '<button id="drv-add">+ Add driver</button>';
  list.forEach((d) => {
    fleetEl.querySelector(`[data-del="${d.id}"]`).onclick = async () => {
      try { await LLAPI.deleteDriver(d.id); renderFleet(); }
      catch (e) { alert(e.message); }
    };
    fleetEl.querySelector(`[data-mkt="${d.id}"]`).onchange = (e) => saveField(d.id, "currentMarket", e.target.value.trim().toUpperCase());
    fleetEl.querySelector(`[data-eq="${d.id}"]`).onchange = (e) => saveField(d.id, "equipment", e.target.value || null);
    fleetEl.querySelector(`[data-cpm="${d.id}"]`).onchange = (e) => {
      const v = parseFloat(e.target.value);
      saveField(d.id, "costPerMile", isNaN(v) ? null : v);
    };
    const saveHos = async () => {
      const driveH = parseFloat(fleetEl.querySelector(`[data-drive="${d.id}"]`).value);
      const dutyH  = parseFloat(fleetEl.querySelector(`[data-duty="${d.id}"]`).value);
      const cycleH = parseFloat(fleetEl.querySelector(`[data-cycle="${d.id}"]`).value);
      try {
        await LLAPI.updateDriver(d.id, {
          hos: {
            remainingDrive:  Math.round(driveH * 60),
            remainingOnDuty: Math.round(dutyH  * 60),
            remainingCycle:  Math.round(cycleH * 60),
          },
        });
      } catch (e) { alert(e.message); }
    };
    fleetEl.querySelector(`[data-drive="${d.id}"]`).onchange = saveHos;
    fleetEl.querySelector(`[data-duty="${d.id}"]`).onchange = saveHos;
    fleetEl.querySelector(`[data-cycle="${d.id}"]`).onchange = saveHos;
  });
  document.getElementById("drv-add").onclick = addDriver;
}

function driverRow(d) {
  const opts = ['<option value="">—</option>'].concat(EQUIP_TYPES.map((e) => equipOption(e, d.equipment))).join("");
  const eid = escA(d.id);
  const h = d.hos || {};
  const driveH = h.remainingDrive != null ? round1(h.remainingDrive / 60) : "";
  const dutyH  = h.remainingOnDuty != null ? round1(h.remainingOnDuty / 60) : "";
  const cycleH = h.remainingCycle != null ? round1(h.remainingCycle / 60) : "";
  return `<div style="border-bottom:1px solid #eee;padding-bottom:4px;margin-bottom:4px">` +
    `<div class="row"><span class="k">${escA(d.name || "")}</span>` +
    `<span><input data-mkt="${eid}" type="text" value="${escA(d.currentMarket || "")}" placeholder="CHICAGO_IL" style="width:96px">` +
    `<select data-eq="${eid}">${opts}</select>` +
    `<button data-del="${eid}" title="Delete" style="width:auto;margin:0 0 0 4px;padding:4px 8px">✕</button></span></div>` +
    `<div class="row" style="font-size:11px">` +
    `<span class="k" style="min-width:0">$/mi</span>` +
    `<span><input data-cpm="${eid}" type="number" step="0.05" min="0" value="${escA(d.costPerMile ?? "")}" placeholder="default" style="width:44px">` +
    `<span style="margin-left:4px">Drive</span><input data-drive="${eid}" type="number" step="0.5" min="0" max="11" value="${driveH}" style="width:34px">` +
    `<span style="margin-left:2px">Duty</span><input data-duty="${eid}" type="number" step="0.5" min="0" max="14" value="${dutyH}" style="width:34px">` +
    `<span style="margin-left:2px">Cyc</span><input data-cycle="${eid}" type="number" step="1" min="0" max="70" value="${cycleH}" style="width:34px"></span>` +
    `</div></div>`;
}

async function saveField(id, field, value) {
  try { await LLAPI.updateDriver(id, { [field]: value }); } catch (e) { alert(e.message); }
}

// ---- Telegram-уведомления (Pro): привязка чата + тумблер алертов ----
const tgEl = document.getElementById("telegram");

async function renderTelegram(me) {
  if (me === undefined) me = await LLAPI.getMe().catch(() => null);
  if (!me) { tgEl.innerHTML = ""; return; }
  if (me.plan !== "pro") {
    tgEl.innerHTML = '<h4>Telegram alerts <span class="plan pro">PRO</span></h4>' +
      '<div class="note">Alerts for profitable loads matching your filter are a Pro feature.</div>';
    return;
  }
  const st = await LLAPI.telegramStatus().catch(() => null);
  if (!st) { tgEl.innerHTML = '<h4>Telegram alerts</h4><div class="note">Could not load status.</div>'; return; }
  if (!st.configured) {
    tgEl.innerHTML = '<h4>Telegram alerts</h4><div class="note">The bot is not configured on the server.</div>';
    return;
  }
  if (!st.linked) {
    tgEl.innerHTML = '<h4>Telegram alerts</h4>' +
      '<div class="note">Connect Telegram to receive profitable loads (green + your equipment filter) as a direct message.</div>' +
      '<button id="tg-link">Connect Telegram</button>';
    document.getElementById("tg-link").onclick = async () => {
      try {
        const r = await LLAPI.telegramLink();
        if (r.url) { chrome.tabs.create({ url: r.url }); }
        else alert("The bot is not configured on the server.");
      } catch (e) { alert(e.message); }
    };
    return;
  }
  tgEl.innerHTML = '<h4>Telegram alerts</h4>' +
    '<div class="row"><span class="k">Status</span><span>linked ✓</span></div>' +
    `<div class="row"><span class="k">Send alerts</span>` +
    `<input id="tg-toggle" type="checkbox"${st.enabled ? " checked" : ""} style="width:auto"></div>` +
    '<button id="tg-unlink" class="danger">Disconnect Telegram</button>' +
    '<div class="note">One load = one message, duplicates filtered out. Works only while a DAT tab is open.</div>';
  document.getElementById("tg-toggle").onchange = async (e) => {
    try { await LLAPI.telegramAlerts(e.target.checked); }
    catch (err) { alert(err.message); e.target.checked = !e.target.checked; }
  };
  document.getElementById("tg-unlink").onclick = async () => {
    if (!confirm("Disconnect Telegram? Alerts will stop.")) return;
    try { await LLAPI.telegramUnlink(); renderTelegram(me); }
    catch (e) { alert(e.message); }
  };
}

async function addDriver() {
  const name = prompt("Driver name:");
  if (!name || !name.trim()) return;
  try { await LLAPI.createDriver({ name: name.trim() }); renderFleet(); }
  catch (e) { alert(e.message); }
}

renderSettings();
LLAPI.getMe().then(
  (u) => { (u ? accRow(u) : accForm()); renderFleet(u || null); renderTelegram(u || null); },
  () => { accForm(); renderFleet(null); renderTelegram(null); },
);
