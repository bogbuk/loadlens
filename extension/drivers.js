/* LoadLens — LLDRV: парк водителей диспетчера. Чистый выбор контекста планировщика
   (resolveDriverContext/pickActive — тестируются node:test) + per-device активный водитель
   (chrome.storage.local). Профили живут на бэкенде (LLAPI), здесь только кэш и выбор. */
const LLDRV = (() => {
  "use strict";
  const ACTIVE_KEY = "ll_active_driver";
  const DEFAULT_CPM = 1.80;
  const FRESH = { remainingDrive: 11 * 60, remainingOnDuty: 14 * 60, remainingCycle: 70 * 60 };

  // Чистая: из активного водителя (или его отсутствия) собрать контекст для планировщика/скоринга.
  // fallback = { market, hos, costPerMile } — текущие аноним-настройки (авто-рынок выдачи и т.п.).
  function resolveDriverContext(activeDriver, fallback) {
    const fb = fallback || {};
    const fbCpm = fb.costPerMile != null ? fb.costPerMile : DEFAULT_CPM;
    if (!activeDriver) {
      return { market: fb.market || null, hos: fb.hos ? { ...fb.hos } : { ...FRESH }, equipment: null, costPerMile: fbCpm };
    }
    return {
      market: activeDriver.currentMarket || fb.market || null,
      hos: activeDriver.hos ? { ...activeDriver.hos } : (fb.hos ? { ...fb.hos } : { ...FRESH }),
      equipment: activeDriver.equipment || null,
      costPerMile: activeDriver.costPerMile != null ? activeDriver.costPerMile : fbCpm,
    };
  }

  // Выбрать активного из списка по сохранённому id; если его нет — первый; пустой список → null.
  function pickActive(list, activeId) {
    if (!Array.isArray(list) || !list.length) return null;
    return list.find((d) => d.id === activeId) || list[0];
  }

  async function getActiveId() {
    try { return (await chrome.storage.local.get(ACTIVE_KEY))[ACTIVE_KEY] || null; } catch { return null; }
  }
  async function setActive(id) {
    try { await chrome.storage.local.set({ [ACTIVE_KEY]: id }); } catch { /* офлайн */ }
  }

  return { resolveDriverContext, pickActive, getActiveId, setActive, FRESH };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LLDRV;
if (typeof globalThis !== "undefined") globalThis.LLDRV = LLDRV;
