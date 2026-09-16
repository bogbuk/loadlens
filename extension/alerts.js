/* LoadLens alerts — релей подошедших грузов (green + фильтр прицепа) в Telegram.
   Принимает {load, rule} от LLRULES.select; ruleName — имя сработавшего правила, печатается ботом первой строкой.
   Только грузы, которые пользователь уже видит в своей сессии (ToS). Шлём lane/ставку/мили/RPM/
   брокера (имя+MC+кредит), возраст постинга, дату пикапа, контакт и комментарий груза — PII уходит в личный DM
   пользователя по явному решению. Дедуп: session-Set (сеть) + авторитетный сервер.
   Гейт: Pro + привязанный Telegram + включённые алерты (статус кэшируем). */
const LLALERT = (() => {
  "use strict";

  // Возраст постинга считает канон-модель (vendor/ — автокопия shared/load.model.js).
  const MODEL = (typeof LLMODEL !== "undefined") ? LLMODEL
    : (typeof require === "function" ? require("./vendor/load.model.js") : null);
  const ageOf = (l) => (MODEL ? MODEL.ageMinutes(l, Date.now()) : null);

  const sentKeys = new Set();             // сессионный дедуп: не дёргаем сеть на уже отправленный груз
  let status = { linked: false, enabled: false, configured: false };
  let statusTs = 0;
  const STATUS_TTL = 5 * 60 * 1000;
  const MAX_BATCH = 50;                    // совпадает с ArrayMaxSize на сервере

  // Семантический ключ дедупа = бизнес-идентичность груза (resultId композитный/плывёт — не годится).
  function keyFor(l) {
    const mc = String(l.brokerMc || "").replace(/\D+/g, "");
    return [l.board, `${l.originMarket}>${l.destMarket}`, l.equipment,
            Math.round(l.rate || 0), Math.round(l.loadedMiles || 0), mc].join("|");
  }

  // Полезная нагрузка для сервера — бизнес-поля + (осознанно) дата пикапа и контакт брокера.
  // Контакт (email/phone) — это PII; шлём по явному решению, чтобы диспетчер мог сразу связаться.
  function toPayload(l, rule) {
    const mc = String(l.brokerMc || "").replace(/\D+/g, "");
    const item = {
      dedupKey: keyFor(l),
      originMarket: l.originMarket, destMarket: l.destMarket, equipment: l.equipment,
      rate: Math.round(l.rate || 0), loadedMiles: Math.round(l.loadedMiles || 0),
    };
    if (l.deadheadMiles) item.deadheadMiles = Math.round(l.deadheadMiles);
    if (mc) item.brokerMc = mc;
    if (l.brokerName) item.brokerName = String(l.brokerName).replace(/[\n\r]+/g, " ").trim().slice(0, 120);
    if (l.creditScore != null && !isNaN(l.creditScore)) item.creditScore = Math.round(l.creditScore);
    if (l.comments) item.comments = String(l.comments).replace(/[\n\r]+/g, " ").trim().slice(0, 300);
    const age = ageOf(l);
    if (age != null) item.ageMinutes = Math.round(age);
    const pickup = l.availability && l.availability.earliest;
    if (pickup) item.pickupDate = String(pickup).slice(0, 32);
    if (l.contactEmail) item.contactEmail = String(l.contactEmail).slice(0, 120);
    if (l.contactPhone) item.contactPhone = String(l.contactPhone).replace(/[^\d+().\- ]/g, "").slice(0, 24);
    const ruleName = rule && rule.name ? String(rule.name).replace(/[\n\r]+/g, " ").trim().slice(0, 60) : "";
    if (ruleName) item.ruleName = ruleName;
    return item;
  }

  // rate не обязателен: DAT часто не публикует ставку ("call for rate"), груз всё равно валиден,
  // если правило матчит его по другим условиям (ключевые слова, equipment и т.д.).
  function validItem(it) {
    return it.originMarket && it.destMarket && it.equipment && it.rate >= 0 && it.loadedMiles > 0;
  }

  async function refreshStatus(force) {
    const now = Date.now();
    if (!force && now - statusTs < STATUS_TTL) return status;
    const s = typeof LLAPI !== "undefined" ? await LLAPI.telegramStatus() : null;
    if (s) { status = s; statusTs = now; }
    return status;
  }

  // Принимает [{load, rule}] (отбор LLRULES) или голые грузы (старый вызов). Шлёт новые на backend-релей.
  async function push(hits) {
    if (!hits || !hits.length) return { sent: 0 };
    const s = await refreshStatus();
    if (!s.configured || !s.linked || !s.enabled) return { sent: 0 };

    const pairs = hits.map((h) => (h && h.load) ? h : { load: h, rule: null });
    const fresh = pairs.filter((p) => p.load && !sentKeys.has(keyFor(p.load)));
    if (!fresh.length) return { sent: 0 };

    // Свежие вперёд: если подошедших больше MAX_BATCH, срезать надо протухшие постинги, а не те,
    // что брокер только что обновил (груз без известного возраста — в хвост).
    const ordered = MODEL ? MODEL.byFreshness(fresh.map((p) => p.load), Date.now())
      .map((load) => fresh.find((p) => p.load === load)) : fresh;
    const items = ordered.map((p) => toPayload(p.load, p.rule)).filter(validItem).slice(0, MAX_BATCH);
    if (!items.length) return { sent: 0 };

    // оптимистично помечаем отправленными (повторный показ той же выдачи не спамит сеть)
    items.forEach((it) => sentKeys.add(it.dedupKey));
    const res = typeof LLAPI !== "undefined" ? await LLAPI.notifyAlerts(items) : null;
    return res || { sent: 0 };
  }

  // сброс кэша статуса (например, после смены настроек в попапе) — необязателен, но полезен
  function resetStatus() { statusTs = 0; }

  return { keyFor, toPayload, validItem, refreshStatus, push, resetStatus,
           _setStatus: (s) => { status = s; statusTs = Date.now(); } };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLALERT; }
if (typeof globalThis !== "undefined") globalThis.LLALERT = LLALERT;
