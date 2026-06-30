/* LoadLens — ручной фильтр прицепа (ll_equip_filter).
   Формат хранения: string[] | null. null/[] = «фильтра нет, показывать все».
   normalize терпит старый формат (одиночная строка) для обратной совместимости. */
const LLEQUIP = (() => {
  // → string[] | null. Строку оборачивает в массив, пустые элементы отсекает, всё пустое → null.
  function normalize(v) {
    const arr = (Array.isArray(v) ? v : (v ? [v] : [])).filter(Boolean);
    return arr.length ? arr : null;
  }
  // груз проходит, если фильтр пуст ИЛИ его прицеп в наборе.
  function matches(filter, equipment) {
    const norm = normalize(filter);
    return !norm || norm.includes(equipment);
  }
  return { normalize, matches };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLEQUIP; }
if (typeof globalThis !== "undefined") globalThis.LLEQUIP = LLEQUIP;
