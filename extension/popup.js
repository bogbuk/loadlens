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
  const { ll_cpm, ll_targets, ll_equip_filter, ll_autorefresh, ll_sort, ll_hide_panel, ll_hide_badges, ll_mail_template, ll_sse_alerts } =
    await chrome.storage.local.get(["ll_cpm", "ll_targets", "ll_equip_filter", "ll_autorefresh", "ll_sort", "ll_hide_panel", "ll_hide_badges", "ll_mail_template", "ll_sse_alerts"]);
  const mailTpl = (typeof ll_mail_template === "string" && ll_mail_template.trim()) ? ll_mail_template : LLMAIL.DEFAULT_TEMPLATE;
  const cpm = ll_cpm != null ? ll_cpm : 1.80;
  const targets = Array.isArray(ll_targets) && ll_targets.length ? ll_targets : DEFAULT_TARGETS;
  const ar = (ll_autorefresh && typeof ll_autorefresh === "object") ? ll_autorefresh : { on: false, intervalMs: 180000 };
  // ключа ещё нет (старая настройка) → LLPOLICY подставит дефолтное ночное окно 22–5
  const quiet = LLPOLICY.normalizeQuiet("quiet" in ar ? ar.quiet : undefined);
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
    `<div class="row"><span class="k">Enable on DAT tabs</span><input id="s-ar-on" type="checkbox"${ar.on ? " checked" : ""} style="width:auto"></div>` +
    '<div class="note">Applies to every DAT tab; the Auto-refresh checkbox in the on-page panel overrides it for that tab only.</div>' +
    `<div class="row"><span class="k">Interval, sec (≥120)</span><input id="s-ar-int" type="number" min="120" step="30" value="${Math.round((ar.intervalMs || 180000) / 1000)}"></div>` +
    `<div class="row"><span class="k">Auto-scroll (pull all pages)</span><input id="s-ar-scroll" type="checkbox"${ar.autoscroll !== false ? " checked" : ""} style="width:auto"></div>` +
    `<div class="row"><span class="k">Quiet hours</span><span><input id="s-ar-quiet" type="checkbox"${quiet ? " checked" : ""} style="width:auto"> ` +
    `from <input id="s-ar-quiet-from" type="number" min="0" max="23" value="${quiet ? quiet.from : 22}" style="width:48px"> ` +
    `to <input id="s-ar-quiet-to" type="number" min="0" max="23" value="${quiet ? quiet.to : 5}" style="width:48px"></span></div>` +
    `<div class="note">Auto-pilot pauses overnight — brokers barely post then, and a flat round-the-clock pattern is what stands out most. Hours follow this machine's clock, which now reads <b>${escA(machineClock())}</b> (in the cloud browser that is the server's time, not yours).</div>` +
    `<div class="row"><span class="k">Sort</span><select id="s-sort-f">` +
    ['<option value="">— keep current —</option>'].concat(SORT_FIELDS.map((s) =>
      `<option value="${s.field}"${sort.field === s.field ? " selected" : ""}>${escA(s.label)}</option>`)).join("") +
    `</select></div>` +
    `<div class="row"><span class="k">Direction</span><select id="s-sort-d">` +
    `<option value="desc"${sort.dir === "desc" ? " selected" : ""}>Highest → Lowest</option>` +
    `<option value="asc"${sort.dir === "asc" ? " selected" : ""}>Lowest → Highest</option></select></div>` +
    '<h4>DAT live matches</h4>' +
    `<div class="row"><span class="k">Listen to DAT live matches</span><input id="s-sse" type="checkbox"${ll_sse_alerts ? " checked" : ""} style="width:auto"></div>` +
    '<div class="note">DAT already streams new matching loads to every open search tab. With this on, LoadLens reads that stream, adds new loads to the panel and runs your Telegram alert rules on them the moment they appear — no refresh needed, no extra requests to DAT. Needs a DAT plan with live matches (Pro and up); on lower plans nothing arrives and the auto-pilot remains the way to get alerts. Applies instantly.</div>' +
    '<h4>On-page display</h4>' +
    `<div class="row"><span class="k">Hide panel on page</span><input id="s-hide-panel" type="checkbox"${ll_hide_panel ? " checked" : ""} style="width:auto"></div>` +
    `<div class="row"><span class="k">Hide badges in table</span><input id="s-hide-badges" type="checkbox"${ll_hide_badges ? " checked" : ""} style="width:auto"></div>` +
    '<h4>Broker email template</h4>' +
    `<textarea id="s-mail-tpl" rows="9" style="width:100%;box-sizing:border-box;font:11px/1.4 ui-monospace,monospace">${escA(mailTpl)}</textarea>` +
    '<div class="chips-bar"><span class="note">Used by "✉️ Email broker" on a load card.</span>' +
    '<span class="chips-actions"><button type="button" class="linkbtn" id="s-mail-reset">Reset to default</button></span></div>' +
    '<button id="s-save">Save</button>' +
    '<div class="note">Target $/mi is the "profitable" (green) threshold: a load is green when its gross $/mile is at or above the target for its distance bucket. Cost/mile is the break-even line below which a load is a loss (red).</div>' +
    '<div class="note">"On-page display" applies instantly to all DAT/Truckstop tabs — no need to press Save.</div>' +
    '<div class="note">Email placeholders: {{origin}} {{dest}} {{equipment}} {{rate}} {{rateBasis}} {{loadedMiles}} {{deadheadMiles}} {{trueRpm}} {{pickupDate}} {{brokerName}} {{brokerMc}} {{driverName}} {{counterOffer}}. A line holding only an empty placeholder is dropped — {{counterOffer}} disappears when the rate or miles are unknown.</div>' +
    '<div class="note">Auto-pilot: "Enable on DAT tabs" switches it on for every DAT results tab; the "Auto-refresh" toggle in the on-page panel header overrides it for that tab only. Also set here: the shared interval (3 minutes by default, with jitter; 2 minutes is the floor), quiet hours, the sort order to hold, and auto-scroll (scrolls the results so DAT loads every page; the panel accumulates them by searchId). While DAT\'s live match stream is running the auto-pilot checks far less often — new loads arrive on their own.</div>';
  document.getElementById("s-save").onclick = save;
  document.getElementById("s-mail-reset").onclick = () => { document.getElementById("s-mail-tpl").value = LLMAIL.DEFAULT_TEMPLATE; };
  wireEquipChips();
  // «Отображение на странице» — instant-apply (без кнопки «Сохранить»); content.js слушает storage.onChanged
  document.getElementById("s-hide-panel").onchange = (e) => chrome.storage.local.set({ ll_hide_panel: e.target.checked });
  document.getElementById("s-hide-badges").onchange = (e) => chrome.storage.local.set({ ll_hide_badges: e.target.checked });
  document.getElementById("s-sse").onchange = (e) => chrome.storage.local.set({ ll_sse_alerts: e.target.checked });
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
// Текущее время ЭТОЙ машины: окно тишины считается по её часам, а в облачном браузере это время
// сервера, а не водителя — без подсказки пользователь выставит часы вслепую.
function machineClock() {
  const d = new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
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
  // пустой шаблон = «вернуть дефолт» (content.js подставит DEFAULT_TEMPLATE)
  const tpl = document.getElementById("s-mail-tpl").value;
  await chrome.storage.local.set({ ll_mail_template: tpl.trim() ? tpl : null });
  // авто-пилот: интервал не реже 120с (ToS-футпринт); сорт = поле+направление (пусто → не удерживать)
  const intSec = Math.max(120, parseInt(document.getElementById("s-ar-int").value, 10) || 180);
  const autoscroll = document.getElementById("s-ar-scroll").checked;
  // выключенное окно тишины храним как null — LLPOLICY отличает его от «ключа ещё нет» (дефолт)
  const quietOn = document.getElementById("s-ar-quiet").checked;
  const quietVal = quietOn ? LLPOLICY.normalizeQuiet({
    from: document.getElementById("s-ar-quiet-from").value,
    to: document.getElementById("s-ar-quiet-to").value,
  }) : null;
  const sortField = document.getElementById("s-sort-f").value || null;
  const arOn = document.getElementById("s-ar-on").checked;
  await chrome.storage.local.set({
    // on — глобальный тумблер (per-tab override живёт в sessionStorage вкладки, см. content.js)
    ll_autorefresh: { on: arOn, intervalMs: intSec * 1000, autoscroll, quiet: quietVal },
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
  document.getElementById("acc-out").onclick = async () => { await LLAPI.logout(); accForm(); renderFleet(null); renderTelegram(null); renderCloud(null); };
  document.getElementById("acc-del").onclick = async () => {
    if (!confirm("Delete your account permanently? Your profile and all drivers will be removed. This does not cancel your DAT/Truckstop subscription.")) return;
    try { await LLAPI.deleteAccount(); accForm("Account deleted."); renderFleet(null); renderTelegram(null); renderCloud(null); }
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
    try { const u = await fn(email, pass); accRow(u); renderFleet(u); renderTelegram(u); renderCloud(u); }
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
      renderFleet(null); renderTelegram(null); renderCloud(null);
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

// ---- Telegram: привязка чата (любой план — для сброса пароля) + тумблер алертов и правила (Pro) ----
const tgEl = document.getElementById("telegram");

// ---- правила алертов (ll_alert_rules): список карточек + inline-редактор ----
let rulesCfg = { version: 1, rules: [] };
let editingRuleId = null;   // id правила в редакторе; "new" — черновик нового

async function loadRules() {
  const { ll_alert_rules } = await chrome.storage.local.get("ll_alert_rules");
  rulesCfg = LLRULES.normalize(ll_alert_rules);
}
async function saveRules() {
  rulesCfg = LLRULES.normalize(rulesCfg);
  await chrome.storage.local.set({ ll_alert_rules: rulesCfg });
}
const csv = (arr) => (arr || []).join(", ");
const splitCsv = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
const numOrNull = (id) => { const v = document.getElementById(id).value; return v === "" ? null : Number(v); };

function ruleSummary(r) {
  const bits = [];
  if (r.keywordsAny.length) bits.push(`any: ${csv(r.keywordsAny)}`);
  if (r.keywordsNone.length) bits.push(`none: ${csv(r.keywordsNone)}`);
  if (r.minRate != null) bits.push(`≥ $${r.minRate}`);
  if (r.minRpm != null) bits.push(`≥ $${r.minRpm}/mi`);
  if (r.maxDeadhead != null) bits.push(`DH ≤ ${r.maxDeadhead}`);
  if (r.minMiles != null || r.maxMiles != null) bits.push(`${r.minMiles ?? 0}–${r.maxMiles ?? "∞"} mi`);
  if (r.equipment) bits.push(`equip: ${csv(r.equipment)}`);
  if (r.destStates.length) bits.push(`to: ${csv(r.destStates)}`);
  if (r.brokersAllow.length) bits.push(`brokers: ${csv(r.brokersAllow)}`);
  if (r.brokersBlock.length) bits.push(`block: ${csv(r.brokersBlock)}`);
  if (r.minCredit != null) bits.push(`credit ≥ ${r.minCredit}`);
  if (r.score !== "any") bits.push(r.score === "green" ? "green only" : "green + amber");
  return bits.length ? bits.join(" · ") : "no conditions = every load";
}

function ruleCard(r) {
  return `<div class="rule" data-id="${escA(r.id)}"><div class="rhd">` +
    `<input type="checkbox" class="rule-on" style="width:auto"${r.enabled ? " checked" : ""}>` +
    `<b>${escA(r.name)}</b>` +
    `<button type="button" class="linkbtn rule-edit">Edit</button>` +
    `<button type="button" class="linkbtn rule-del">Delete</button></div>` +
    `<div class="sum">${escA(ruleSummary(r))}</div></div>`;
}

function ruleForm(r) {
  const eqSel = new Set(r.equipment || []);
  const scoreOpt = (v, label) => `<option value="${v}"${r.score === v ? " selected" : ""}>${label}</option>`;
  return `<div class="rule" data-id="${escA(r.id)}">` +
    `<label>Name</label><input type="text" id="rf-name" value="${escA(r.name)}" maxlength="${LLRULES.LIMITS.name}" placeholder="Rule name">` +
    `<label>Comments contain any of (comma-separated)</label><input type="text" id="rf-any" value="${escA(csv(r.keywordsAny))}" placeholder="bonded, in-bond, TWIC, airport">` +
    `<label>Comments must NOT contain</label><input type="text" id="rf-none" value="${escA(csv(r.keywordsNone))}" placeholder="hazmat, team">` +
    `<div class="two"><div><label>Min rate, $</label><input type="text" id="rf-rate" inputmode="decimal" value="${r.minRate ?? ""}"></div>` +
    `<div><label>Min $/mi (incl. deadhead)</label><input type="text" id="rf-rpm" inputmode="decimal" value="${r.minRpm ?? ""}"></div></div>` +
    `<div class="two"><div><label>Max deadhead, mi</label><input type="text" id="rf-dh" inputmode="numeric" value="${r.maxDeadhead ?? ""}"></div>` +
    `<div><label>Min credit score</label><input type="text" id="rf-credit" inputmode="numeric" value="${r.minCredit ?? ""}"></div></div>` +
    `<div class="two"><div><label>Min loaded miles</label><input type="text" id="rf-minmi" inputmode="numeric" value="${r.minMiles ?? ""}"></div>` +
    `<div><label>Max loaded miles</label><input type="text" id="rf-maxmi" inputmode="numeric" value="${r.maxMiles ?? ""}"></div></div>` +
    `<label>Equipment (none selected = same as global filter)</label><div class="chips" id="rf-equip">` +
    EQUIP_TYPES.map((e) => `<button type="button" class="chip${eqSel.has(e.code) ? " on" : ""}" data-code="${escA(e.code)}" title="${escA(e.label)}">${escA(e.code)}</button>`).join("") +
    `</div>` +
    `<label>Destination states (comma-separated)</label><input type="text" id="rf-states" value="${escA(csv(r.destStates))}" placeholder="TX, OK, ON">` +
    `<div class="two"><div><label>Brokers allow (MC)</label><input type="text" id="rf-allow" value="${escA(csv(r.brokersAllow))}"></div>` +
    `<div><label>Brokers block (MC)</label><input type="text" id="rf-block" value="${escA(csv(r.brokersBlock))}"></div></div>` +
    `<label>Score</label><select id="rf-score">${scoreOpt("any", "Any")}${scoreOpt("green", "Green only")}${scoreOpt("green_amber", "Green or amber")}</select>` +
    `<div class="note">All filled conditions must match (AND). Rules combine with OR. A rule without conditions matches every load.</div>` +
    `<div class="actions"><button type="button" id="rf-save">Save rule</button><button type="button" id="rf-cancel">Cancel</button></div></div>`;
}

function readRuleForm(id) {
  return {
    id,
    name: document.getElementById("rf-name").value,
    enabled: (rulesCfg.rules.find((r) => r.id === id) || { enabled: true }).enabled,
    keywordsAny: splitCsv(document.getElementById("rf-any").value),
    keywordsNone: splitCsv(document.getElementById("rf-none").value),
    minRate: numOrNull("rf-rate"), minRpm: numOrNull("rf-rpm"),
    maxDeadhead: numOrNull("rf-dh"), minCredit: numOrNull("rf-credit"),
    minMiles: numOrNull("rf-minmi"), maxMiles: numOrNull("rf-maxmi"),
    equipment: [...document.querySelectorAll("#rf-equip .chip.on")].map((c) => c.dataset.code),
    destStates: splitCsv(document.getElementById("rf-states").value),
    brokersAllow: splitCsv(document.getElementById("rf-allow").value),
    brokersBlock: splitCsv(document.getElementById("rf-block").value),
    score: document.getElementById("rf-score").value,
  };
}

function renderRules() {
  const box = document.getElementById("tg-rules");
  if (!box) return;
  const draft = editingRuleId === "new"
    ? LLRULES.normalize({ rules: [{ id: "new", name: "" }] }).rules[0] : null;
  if (draft) draft.name = ""; // не показывать подставленное normalize имя "Rule" в пустом поле
  const cards = rulesCfg.rules.map((r) => (r.id === editingRuleId ? ruleForm(r) : ruleCard(r))).join("");
  const full = rulesCfg.rules.length >= LLRULES.LIMITS.rules;
  box.innerHTML = '<h4>Alert rules</h4>' +
    (rulesCfg.rules.length || draft ? "" : '<div class="note">No rules: every profitable (green) load matching your equipment filter is sent.</div>') +
    cards + (draft ? ruleForm(draft) : "") +
    (editingRuleId || full ? "" : '<button type="button" id="rule-add" style="margin-top:8px">Add rule</button>');

  box.querySelectorAll(".rule-on").forEach((cb) => cb.onchange = async (e) => {
    const id = e.target.closest(".rule").dataset.id;
    const r = rulesCfg.rules.find((x) => x.id === id); if (r) { r.enabled = e.target.checked; await saveRules(); renderRules(); }
  });
  box.querySelectorAll(".rule-edit").forEach((b) => b.onclick = (e) => { editingRuleId = e.target.closest(".rule").dataset.id; renderRules(); });
  box.querySelectorAll(".rule-del").forEach((b) => b.onclick = async (e) => {
    const id = e.target.closest(".rule").dataset.id;
    if (!confirm("Delete this rule?")) return;
    rulesCfg.rules = rulesCfg.rules.filter((x) => x.id !== id); await saveRules(); renderRules();
  });
  const add = document.getElementById("rule-add");
  if (add) add.onclick = () => { editingRuleId = "new"; renderRules(); };
  box.querySelectorAll("#rf-equip .chip").forEach((c) => c.onclick = () => c.classList.toggle("on"));
  const save = document.getElementById("rf-save");
  if (save) save.onclick = async () => {
    const isNew = editingRuleId === "new";
    const id = isNew ? `r_${Date.now()}` : editingRuleId;
    const next = readRuleForm(id);
    if (isNew) rulesCfg.rules.push(next);
    else rulesCfg.rules = rulesCfg.rules.map((r) => (r.id === id ? next : r));
    editingRuleId = null; await saveRules(); renderRules();
  };
  const cancel = document.getElementById("rf-cancel");
  if (cancel) cancel.onclick = () => { editingRuleId = null; renderRules(); };
}

// Секция Telegram. Привязка/отвязка — для ЛЮБОГО плана: код сброса пароля приходит только в бота,
// без привязки забытый пароль = потерянный аккаунт (бэкенд на link/status/unlink Pro и не требует).
// Pro-гейт стоит там, где он и есть на бэкенде: тумблер алертов (PATCH /telegram/alerts) и правила.
async function renderTelegram(me) {
  if (me === undefined) me = await LLAPI.getMe().catch(() => null);
  if (!me) { tgEl.innerHTML = ""; return; }
  const isPro = me.plan === "pro";
  const st = await LLAPI.telegramStatus().catch(() => null);
  if (!st) { tgEl.innerHTML = '<h4>Telegram</h4><div class="note">Could not load status.</div>'; return; }
  if (!st.configured) {
    tgEl.innerHTML = '<h4>Telegram</h4><div class="note">The bot is not configured on the server.</div>';
    return;
  }
  if (!st.linked) {
    tgEl.innerHTML = '<h4>Telegram</h4>' +
      '<div class="note">' + (isPro
        ? 'Connect Telegram to receive profitable loads (green + your equipment filter) as a direct message. Password reset codes arrive in the bot as well.'
        : 'Connect Telegram to keep your account recoverable: the password reset code is sent to the bot. With Pro the bot also sends loads that match your alert rules.') +
      '</div><button id="tg-link">Connect Telegram</button>';
    document.getElementById("tg-link").onclick = async () => {
      try {
        const r = await LLAPI.telegramLink();
        if (r.url) { chrome.tabs.create({ url: r.url }); }
        else alert("The bot is not configured on the server.");
      } catch (e) { alert(e.message); }
    };
    return;
  }
  tgEl.innerHTML = '<h4>Telegram</h4>' +
    '<div class="row"><span class="k">Status</span><span>linked ✓</span></div>' +
    (isPro
      ? '<div class="row"><span class="k">Send alerts</span>' +
        `<input id="tg-toggle" type="checkbox"${st.enabled ? " checked" : ""} style="width:auto"></div>`
      : '<div class="row"><span class="k">Send alerts</span><span class="plan pro">PRO</span></div>') +
    '<button id="tg-unlink" class="danger">Disconnect Telegram</button>' +
    (isPro
      ? '<div class="note">One load = one message, duplicates filtered out. Works only while a DAT tab is open.</div>' +
        '<div id="tg-rules"></div>'
      : '<div class="note">Password reset codes arrive in the bot. Pro adds load alerts with your own rules — keywords, rate, deadhead, brokers.</div>');
  const toggle = document.getElementById("tg-toggle");
  if (toggle) toggle.onchange = async (e) => {
    try { await LLAPI.telegramAlerts(e.target.checked); }
    catch (err) { alert(err.message); e.target.checked = !e.target.checked; }
  };
  document.getElementById("tg-unlink").onclick = async () => {
    if (!confirm(isPro ? "Disconnect Telegram? Alerts will stop." : "Disconnect Telegram? Password reset codes will stop arriving.")) return;
    try { await LLAPI.telegramUnlink(); renderTelegram(me); }
    catch (e) { alert(e.message); }
  };
  if (!isPro) return;
  await loadRules();
  renderRules();
}

// ---- Cloud browser (Pro Cloud): включает админ (cloud_enabled), пользователь — Enable/Open screen/Disable ----
const cloudEl = document.getElementById("cloud");
const CLOUD_LABELS = {
  off: "not started",
  starting: "starting — open the screen, sign in to DAT and LoadLens",
  ok: "running ✓",
  logged_out: "signed out of DAT — open the screen and sign in",
  stale: "no loads from DAT — open the screen and check the search",
  stopped: "stopped",
  error: "error — try Enable again or contact support",
};
function agoMin(iso) { return iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) + " min ago" : "—"; }

async function renderCloud(me) {
  if (me === undefined) me = await LLAPI.getMe().catch(() => null);
  // План и cloudEnabled кэшируются на 24ч — без принудительного обновления админский
  // флип cloud_enabled увидели бы только через сутки. Один запрос на открытие попапа.
  if (me) me = await LLAPI.getMe(true).catch(() => me);
  if (!me || !me.cloudEnabled) { cloudEl.innerHTML = ""; return; }
  const st = await LLAPI.cloudStatus();
  if (!st) { cloudEl.innerHTML = '<h4>Cloud browser</h4><div class="note">Could not load status.</div>'; return; }
  const running = st.status !== "off" && st.status !== "stopped";
  const { ll_cloud_consent } = await chrome.storage.local.get("ll_cloud_consent");
  cloudEl.innerHTML = '<h4>Cloud browser <span class="plan pro">PRO CLOUD</span></h4>' +
    `<div class="row"><span class="k">Status</span><span>${CLOUD_LABELS[st.status] || st.status}</span></div>` +
    (running ? `<div class="row"><span class="k">Last heartbeat</span><span>${agoMin(st.lastHeartbeatAt)}</span></div>` : "") +
    (running
      ? '<button id="cl-open">Open screen</button>' +
        '<div class="note">Password (the screen will ask for it): <span id="cl-pass" class="mono">…</span> <button id="cl-copy" class="linkbtn">copy</button></div>' +
        // LE-сертификат для домена экрана выпускается ~1–2 мин после Enable: до этого браузер
        // показывает ERR_CERT_AUTHORITY_INVALID. Предупреждаем, пока тенант ещё в `starting`.
        (st.status === "starting" ? '<div class="note">⏳ Just enabled? The screen gets its security certificate in 1–2 minutes — if the browser shows a certificate warning, wait a minute and reload the page.</div>' : "") +
        '<div class="note">Signing in to DAT on this computer will sign out your cloud browser.</div>' +
        '<button id="cl-off" class="danger">Disable Cloud</button>'
      : (ll_cloud_consent ? "" :
          '<label class="note"><input id="cl-consent" type="checkbox" style="width:auto"> I am responsible for my DAT account; DAT may restrict accounts used from cloud servers.</label>') +
        `<button id="cl-on"${ll_cloud_consent ? "" : " disabled"}>Enable Cloud</button>` +
        '<div class="note">Your own Chromium with DAT One and LoadLens runs 24/7 on our server: auto-pilot and Telegram alerts keep working without a computer at home. One DAT sign-in at a time.</div>');
  const consent = document.getElementById("cl-consent");
  if (consent) consent.onchange = () => { document.getElementById("cl-on").disabled = !consent.checked; };
  const on = document.getElementById("cl-on");
  if (on) on.onclick = async () => {
    on.disabled = true; on.textContent = "Starting…";
    try { await chrome.storage.local.set({ ll_cloud_consent: true }); await LLAPI.cloudEnable(); renderCloud(me); }
    catch (e) { alert(e.message); renderCloud(me); }
  };
  const open = document.getElementById("cl-open");
  if (open) {
    LLAPI.cloudScreen().then((s) => { document.getElementById("cl-pass").textContent = s.password; }).catch(() => {});
    open.onclick = async () => {
      try { const s = await LLAPI.cloudScreen(); chrome.tabs.create({ url: s.url }); }
      catch (e) { alert(e.message); }
    };
    document.getElementById("cl-copy").onclick = async () => {
      try { const s = await LLAPI.cloudScreen(); await navigator.clipboard.writeText(s.password); } catch (e) { alert(e.message); }
    };
  }
  const off = document.getElementById("cl-off");
  if (off) off.onclick = async () => {
    if (!confirm("Disable the cloud browser? Alerts from it will stop. Your DAT session stays saved for 30 days.")) return;
    try { await LLAPI.cloudDisable(); renderCloud(me); } catch (e) { alert(e.message); }
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
  async (u) => {
    if (u) accRow(u); else accForm(await LLAPI.takeSignoutMessage());
    renderFleet(u || null); renderTelegram(u || null); renderCloud(u || null);
  },
  async () => { accForm(await LLAPI.takeSignoutMessage()); renderFleet(null); renderTelegram(null); renderCloud(null); },
);
