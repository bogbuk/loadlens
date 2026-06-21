/* LoadLens alerts — релей подошедших грузов (green + фильтр прицепа) в Telegram.
   Только грузы, которые пользователь уже видит в своей сессии (ToS). Контакты/PII не уходят:
   шлём lane/ставку/мили/RPM/broker MC+кредит. Дедуп: session-Set (сеть) + авторитетный сервер.
   Гейт: Pro + привязанный Telegram + включённые алерты (статус кэшируем). */
const LLALERT = (() => {
  "use strict";

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

  // Полезная нагрузка для сервера — только бизнес-поля (без контактов/имён).
  function toPayload(l) {
    const mc = String(l.brokerMc || "").replace(/\D+/g, "");
    const item = {
      dedupKey: keyFor(l),
      originMarket: l.originMarket, destMarket: l.destMarket, equipment: l.equipment,
      rate: Math.round(l.rate || 0), loadedMiles: Math.round(l.loadedMiles || 0),
    };
    if (l.deadheadMiles) item.deadheadMiles = Math.round(l.deadheadMiles);
    if (mc) item.brokerMc = mc;
    if (l.creditScore != null && !isNaN(l.creditScore)) item.creditScore = Math.round(l.creditScore);
    return item;
  }

  function validItem(it) {
    return it.originMarket && it.destMarket && it.equipment && it.rate > 0 && it.loadedMiles > 0;
  }

  async function refreshStatus(force) {
    const now = Date.now();
    if (!force && now - statusTs < STATUS_TTL) return status;
    const s = typeof LLAPI !== "undefined" ? await LLAPI.telegramStatus() : null;
    if (s) { status = s; statusTs = now; }
    return status;
  }

  // Принимает уже отобранные грузы (green + passEquip). Шлёт новые на backend-релей.
  async function push(loads) {
    if (!loads || !loads.length) return { sent: 0 };
    const s = await refreshStatus();
    if (!s.configured || !s.linked || !s.enabled) return { sent: 0 };

    const fresh = loads.filter((l) => !sentKeys.has(keyFor(l)));
    if (!fresh.length) return { sent: 0 };

    const items = fresh.map(toPayload).filter(validItem).slice(0, MAX_BATCH);
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
