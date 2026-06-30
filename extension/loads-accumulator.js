/* LoadLens — накопитель грузов по searchId. Чистая логика (как LLEQUIP/LLVIS/LLTAB), zero-dep.
   DAT пагинирует выдачу: первая страница + следующие (fetchMore при скролле) приходят отдельными
   ответами FindLoads с ОДНИМ searchId. Новый поиск (наш клик SEARCH / reload) даёт НОВЫЙ searchId.
   Поэтому: тот же searchId → доливаем (merge по loadId); новый → сбрасываем; sid=null (старая схема/
   ошибка) → режим перезаписи (прежнее поведение content.js). last-write-wins: свежие данные побеждают. */
const LLACC = (() => {
  "use strict";

  function emptyState() { return { searchId: null, byId: new Map() }; }

  // accumulate(state, parsed, sid) → { state, loads }
  // state = { searchId, byId: Map<loadId, Load> }. Мутирует и возвращает тот же byId (стейт-машина).
  function accumulate(state, parsed, sid) {
    const byId = state && state.byId instanceof Map ? state.byId : new Map();
    let searchId = state ? state.searchId : null;
    if (sid == null) {
      byId.clear(); searchId = null;          // фолбэк: каждый ответ заменяет (как было)
    } else if (sid !== searchId) {
      byId.clear(); searchId = sid;           // новый поиск → сброс накопления
    }
    for (const l of parsed || []) {
      if (l && l.loadId != null) byId.set(String(l.loadId), l);   // дедуп/обновление по loadId
    }
    return { state: { searchId, byId }, loads: [...byId.values()] };
  }

  return { emptyState, accumulate };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLACC; }
if (typeof globalThis !== "undefined") globalThis.LLACC = LLACC;
