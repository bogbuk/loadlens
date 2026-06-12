/* LoadLens — HOS-состояние водителя для планировщика. Грузится после vendor/planner.js.

   Планировщик (LLPLAN) сам моделирует выполнимость каждого плеча через stepHos по остатку
   часов (forward-simulation). Этому модулю остаётся дать СТАРТОВОЕ состояние водителя.

   MVP: состояние вводит пользователь в панели (доступные drive/duty/cycle часы) или дефолт —
   «свежий» (полный ресурс). Парсинг реального ELD-логбука движком shared/hos-calculator.js —
   фаза 2 (интеграция с ELD), хук parseLogbook оставлен заглушкой. */
const LLHOS = (() => {
  "use strict";
  const FRESH = { remainingDrive: 11 * 60, remainingOnDuty: 14 * 60, remainingCycle: 70 * 60 };
  const STORE_KEY = "ll_hos";

  function fresh() { return { ...FRESH }; }

  // Из часов, введённых пользователем, в минуты. cycle по умолчанию 70h.
  function fromHours({ driveH, dutyH, cycleH } = {}) {
    return {
      remainingDrive: Math.round((driveH != null ? driveH : 11) * 60),
      remainingOnDuty: Math.round((dutyH != null ? dutyH : 14) * 60),
      remainingCycle: Math.round((cycleH != null ? cycleH : 70) * 60),
    };
  }

  async function load() {
    try {
      const { ll_hos } = await chrome.storage.local.get(STORE_KEY);
      return ll_hos || fresh();
    } catch { return fresh(); }
  }
  async function save(state) {
    try { await chrome.storage.local.set({ [STORE_KEY]: state }); } catch { /* офлайн */ }
  }

  // Фаза 2: распарсить ELD-логбук в стартовое состояние через HOSCalculator.
  // Возвращает fresh(), пока интеграция с ELD не подключена.
  function parseLogbook(/* logs */) { return fresh(); }

  return { FRESH, fresh, fromHours, load, save, parseLogbook };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LLHOS;
if (typeof globalThis !== "undefined") globalThis.LLHOS = LLHOS;
