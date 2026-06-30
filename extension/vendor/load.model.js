/* AUTO-GENERATED копия из /shared — НЕ РЕДАКТИРОВАТЬ. Источник правды: shared/. Пересобрать: npm run sync:shared */
/* LoadLens — unified Load model + нормализаторы.
   Zero-dep CommonJS: грузится и в браузере (global LLMODEL), и в Node (require), и в тестах.
   Прямой аналог PriceLens row {id,title,price,groupKey,metric,unit,attrs}, где metric=RPM. */
const LLMODEL = (() => {
  "use strict";

  // equipment: канон типов трейлеров — коды DAT One (autocomplete-группы) + наши legacy-коды.
  // Порядок = порядок в выпадающих списках попапа (LLMODEL.EQUIP_TYPES).
  const EQUIP_TYPES = [
    { code: "V",  label: "Vans (Standard)" },
    { code: "F",  label: "Flatbeds" },
    { code: "R",  label: "Reefers" },
    { code: "N",  label: "Conestogas" },
    { code: "C",  label: "Containers" },
    { code: "K",  label: "Decks (Specialized)" },
    { code: "D",  label: "Decks (Standard)" },
    { code: "B",  label: "Dry Bulk" },
    { code: "Z",  label: "Hazardous Materials" },
    { code: "T",  label: "Tankers" },
    { code: "S",  label: "Vans (Specialized)" },
    { code: "O",  label: "Other Equipment" },
    // legacy-коды (не в DAT-группах, но встречаются в сохранённых профилях/Truckstop):
    { code: "SD", label: "Step Deck" },
    { code: "PO", label: "Power Only" },
    { code: "HS", label: "Hotshot" },
  ];

  // нормализуем длинные имена бордов + сами коды к одному коду (V/R/F/...).
  const EQUIP = {
    van: "V", "dry van": "V", "vans (standard)": "V", "vans standard": "V", v: "V",
    flatbed: "F", flatbeds: "F", fb: "F", f: "F",
    reefer: "R", reefers: "R", refrigerated: "R", r: "R",
    conestoga: "N", conestogas: "N", n: "N",
    container: "C", containers: "C", c: "C",
    "decks (specialized)": "K", "decks specialized": "K", "specialized deck": "K", k: "K",
    "decks (standard)": "D", "decks standard": "D", deck: "D", decks: "D", d: "D",
    "dry bulk": "B", bulk: "B", b: "B",
    "hazardous materials": "Z", hazardous: "Z", hazmat: "Z", z: "Z",
    tanker: "T", tankers: "T", tank: "T", t: "T",
    "vans (specialized)": "S", "vans specialized": "S", "specialized van": "S", s: "S",
    "other equipment": "O", other: "O", o: "O",
    "step deck": "SD", stepdeck: "SD", sd: "SD",
    "power only": "PO", po: "PO",
    hotshot: "HS", hs: "HS",
  };
  // DAT One в ответе FindLoads отдаёт ГРАНУЛЯРНЫЙ код трейлера (DD, FD, RGN…), а не код группы
  // (V/F/R/D/K…) и не длинное имя. Карта специфичный-код→группа. Аддитивна: консультируется ТОЛЬКО
  // если код не нашёлся в EQUIP выше (поэтому SD/PO/HS и одиночные коды сохраняют прежнее поведение).
  // DD→K ПОДТВЕРЖДЁН данными (поиск classes:["K"] вернул equipmentType "DD"); прочие — по таблице DAT.
  // Пополняется по мере наблюдения реальных кодов в перехвате.
  const DAT_EQUIP_GROUP = {
    // Vans (Standard)
    VA: "V", VW: "V", VR: "V", VI: "V", VH: "V", VL: "V", VB: "V", VP: "V", VT: "V", VM: "V", VV: "V", VF: "V", VG: "V", VC: "V", VZ: "V",
    // Flatbeds
    FA: "F", FD: "F", FT: "F", FM: "F", FO: "F", FC: "F", FS: "F", FH: "F", FR: "F", FN: "F", FZ: "F", FW: "F",
    // Reefers
    RF: "R", RA: "R", RV: "R", RM: "R", RH: "R", RL: "R", RZ: "R", RN: "R",
    // Decks (Specialized → K): RGN/lowboy/maxi/double-drop
    DD: "K", RGN: "K", LB: "K", LO: "K", LR: "K", MX: "K", DK: "K",
    // Decks (Standard → D): step/drop deck
    DT: "D", SR: "D",
    // Conestoga / Containers / Tankers
    CN: "N", CI: "C", CV: "C", CO: "C", TA: "T", TT: "T",
  };
  function normEquipment(raw) {
    if (!raw) return "?";
    const k = String(raw).trim().toLowerCase();
    if (EQUIP[k]) return EQUIP[k];
    const up = String(raw).trim().toUpperCase();
    if (DAT_EQUIP_GROUP[up]) return DAT_EQUIP_GROUP[up];
    return up.slice(0, 3);
  }

  // rate: "$2,150" -> 2150, "$2150.00" -> 2150, "Call"/"" -> null
  function parseRate(raw) {
    if (raw == null) return null;
    const m = String(raw).replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
    if (!m) return null;
    const n = Math.round(parseFloat(m[1]));
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // miles: "542" / "542 mi" -> 542; пусто/"-" -> null
  function parseMiles(raw) {
    if (raw == null) return null;
    const m = String(raw).replace(/,/g, "").match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  // age публикации в минутах: "15m"->15, "2h"->120, "1d"->1440, "Now"/"-"->0
  function parseAge(raw) {
    if (raw == null) return null;
    const s = String(raw).trim().toLowerCase();
    if (/now|just/.test(s)) return 0;
    const m = s.match(/(\d+)\s*([mhd])/);
    if (!m) { const n = parseInt(s, 10); return Number.isFinite(n) ? n : null; }
    const v = parseInt(m[1], 10);
    return m[2] === "m" ? v : m[2] === "h" ? v * 60 : v * 1440;
  }

  // weight в lbs: "44,000" / "44000 lbs" -> 44000
  function parseWeight(raw) { return parseMiles(raw); }

  // нормализованный ключ рынка: "Chicago","IL" -> "CHICAGO_IL".
  // Город приводим к UPPER без диакритики/пунктуации; штат — 2 буквы.
  function marketKey(city, state) {
    const c = String(city || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const s = String(state || "").trim().toUpperCase().slice(0, 2);
    if (!c) return s || "?";
    return s ? `${c}_${s}` : c;
  }

  function laneKey(board, originMarket, destMarket, equipment) {
    return `${board}|${originMarket}>${destMarket}|${equipment}`;
  }

  // Собрать unified Load из сырых строковых полей адаптера. Возвращает null, если нет гео.
  function buildLoad(raw, board) {
    const originCity = (raw.originCity || "").trim();
    const originState = (raw.originState || "").trim();
    const destCity = (raw.destCity || "").trim();
    const destState = (raw.destState || "").trim();
    if (!originCity && !originState) return null;
    if (!destCity && !destState) return null;

    const equipment = normEquipment(raw.equipment);
    const originMarket = marketKey(originCity, originState);
    const destMarket = marketKey(destCity, destState);
    const rate = parseRate(raw.rate);
    const loadedMiles = parseMiles(raw.loadedMiles);
    const deadheadMiles = parseMiles(raw.deadheadMiles);

    return {
      board,
      loadId: String(raw.loadId || `${originMarket}>${destMarket}|${rate || "x"}|${loadedMiles || "x"}`),
      originCity, originState, destCity, destState,
      originMarket, destMarket,
      equipment,
      rate,
      loadedMiles,
      deadheadMiles,
      weight: parseWeight(raw.weight),
      lengthFt: parseMiles(raw.lengthFt),
      postedAge: parseAge(raw.postedAge),
      brokerMc: raw.brokerMc ? String(raw.brokerMc).trim() : null,
      brokerName: raw.brokerName ? String(raw.brokerName).trim() : null,
      contact: raw.contact ? String(raw.contact).trim() : null, // PII — НЕ уходит на сервер
      groupKey: laneKey(board, originMarket, destMarket, equipment),
    };
  }

  return {
    EQUIP_TYPES,
    normEquipment, parseRate, parseMiles, parseAge, parseWeight,
    marketKey, laneKey, buildLoad,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LLMODEL;
if (typeof globalThis !== "undefined") globalThis.LLMODEL = LLMODEL;
