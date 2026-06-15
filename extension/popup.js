/* LoadLens popup — настройки водителя (cost/mile + HOS-часы) и аккаунт (JWT, план). */
const escA = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---- настройки ----
const setEl = document.getElementById("settings");
async function renderSettings() {
  const { ll_cpm } = await chrome.storage.local.get("ll_cpm");
  const cpm = ll_cpm != null ? ll_cpm : 1.80;
  const hos = await LLHOS.load();
  setEl.innerHTML =
    '<h4>Параметры водителя</h4>' +
    settingRow("Cost / mile, $", "s-cpm", cpm, 0.05) +
    settingRow("Drive left, ч", "s-drive", round1(hos.remainingDrive / 60), 0.5) +
    settingRow("Duty left, ч", "s-duty", round1(hos.remainingOnDuty / 60), 0.5) +
    settingRow("Cycle left, ч", "s-cycle", round1(hos.remainingCycle / 60), 1) +
    '<button id="s-save">Сохранить</button>' +
    '<div class="note">Параметры применяются к скорингу и HOS-бейджам на DAT/Truckstop.</div>';
  document.getElementById("s-save").onclick = save;
}
function settingRow(label, id, val, step) {
  return `<div class="row"><span class="k">${label}</span>` +
    `<input id="${id}" type="number" step="${step}" min="0" value="${val}"></div>`;
}
async function save() {
  const cpm = parseFloat(document.getElementById("s-cpm").value);
  const driveH = parseFloat(document.getElementById("s-drive").value);
  const dutyH = parseFloat(document.getElementById("s-duty").value);
  const cycleH = parseFloat(document.getElementById("s-cycle").value);
  if (cpm > 0) await chrome.storage.local.set({ ll_cpm: cpm });
  await LLHOS.save(LLHOS.fromHours({ driveH, dutyH, cycleH }));
  const btn = document.getElementById("s-save");
  btn.textContent = "Сохранено ✓";
  setTimeout(() => { btn.textContent = "Сохранить"; }, 1200);
}
const round1 = (n) => Math.round(n * 10) / 10;

// ---- аккаунт (копия паттерна PriceLens) ----
const accEl = document.getElementById("account");
function accRow(user) {
  accEl.innerHTML = '<div class="acc"><div class="who"><span>' + escA(user.email) +
    '</span><span class="plan ' + (user.plan === "pro" ? "pro" : "") + '">' +
    (user.plan === "pro" ? "PRO" : "FREE") + "</span></div>" +
    '<button id="acc-out">Выйти</button></div>';
  document.getElementById("acc-out").onclick = async () => { await LLAPI.logout(); accForm(); };
}
function accForm(err) {
  accEl.innerHTML = '<div class="acc"><h4>Аккаунт</h4>' +
    '<input id="acc-email" type="email" placeholder="email" autocomplete="username">' +
    '<input id="acc-pass" type="password" placeholder="пароль (мин. 8)" autocomplete="current-password">' +
    '<div class="err">' + escA(err || "") + "</div>" +
    '<div class="btns"><button id="acc-in">Войти</button><button id="acc-reg">Регистрация</button></div>' +
    '<div class="note">Pro: полные 3-плечевые get-out цепочки + CSV-экспорт грузов.</div></div>';
  const go = (fn) => async () => {
    const email = document.getElementById("acc-email").value.trim();
    const pass = document.getElementById("acc-pass").value;
    try { accRow(await fn(email, pass)); } catch (e) { accForm(e.message); }
  };
  document.getElementById("acc-in").onclick = go(LLAPI.login);
  document.getElementById("acc-reg").onclick = go(LLAPI.register);
}

// ---- парк водителей (виден залогиненному диспетчеру) ----
const fleetEl = document.getElementById("fleet");
const EQUIP = ["V", "R", "F", "SD", "PO"];

async function renderFleet() {
  const me = await LLAPI.getMe().catch(() => null);
  if (!me) { fleetEl.innerHTML = '<h4>Парк водителей</h4><div class="note">Войдите в аккаунт, чтобы вести своих водителей.</div>'; return; }
  let list = [];
  try { list = await LLAPI.getDrivers(); } catch { list = []; }
  fleetEl.innerHTML = '<h4>Парк водителей</h4>' +
    (list.length ? list.map(driverRow).join("") : '<div class="note">Пока нет водителей. Добавьте первого.</div>') +
    '<button id="drv-add">+ Добавить водителя</button>';
  list.forEach((d) => {
    fleetEl.querySelector(`[data-del="${d.id}"]`).onclick = async () => { await LLAPI.deleteDriver(d.id); renderFleet(); };
    fleetEl.querySelector(`[data-mkt="${d.id}"]`).onchange = (e) => saveField(d.id, "currentMarket", e.target.value.trim().toUpperCase());
    fleetEl.querySelector(`[data-eq="${d.id}"]`).onchange = (e) => saveField(d.id, "equipment", e.target.value || null);
  });
  document.getElementById("drv-add").onclick = addDriver;
}

function driverRow(d) {
  const opts = ['<option value="">—</option>'].concat(EQUIP.map((e) =>
    `<option value="${e}"${d.equipment === e ? " selected" : ""}>${e}</option>`)).join("");
  const eid = escA(d.id);
  return `<div class="row"><span class="k">${escA(d.name)}</span>` +
    `<span><input data-mkt="${eid}" type="text" value="${escA(d.currentMarket || "")}" placeholder="CHICAGO_IL" style="width:96px">` +
    `<select data-eq="${eid}">${opts}</select>` +
    `<button data-del="${eid}" title="Удалить" style="width:auto;margin:0 0 0 4px;padding:4px 8px">✕</button></span></div>`;
}

async function saveField(id, field, value) {
  try { await LLAPI.updateDriver(id, { [field]: value }); } catch (e) { alert(e.message); }
}

async function addDriver() {
  const name = prompt("Имя водителя:");
  if (!name || !name.trim()) return;
  try { await LLAPI.createDriver({ name: name.trim() }); renderFleet(); }
  catch (e) { alert(e.message); }
}

renderSettings();
LLAPI.getMe().then((u) => (u ? accRow(u) : accForm())).catch(() => accForm()).finally(renderFleet);
