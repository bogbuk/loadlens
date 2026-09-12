/* LoadLens — правила Telegram-алертов (ll_alert_rules). Чистый модуль: без DOM и сети.
   Внутри правила AND по заданным условиям (null / [] = условие выключено), между правилами OR.
   Нет включённых правил → content.js использует старый отбор (green + фильтр прицепа).
   Спека: docs/superpowers/specs/2026-09-12-alert-rules-engine-design.md */
const LLRULES = (() => {
  "use strict";
  const EQ = (typeof LLEQUIP !== "undefined") ? LLEQUIP
    : (typeof require === "function" ? require("./equip-filter.js") : null);

  const LIMITS = { rules: 20, words: 30, word: 40, mc: 24, name: 60, id: 40 };
  const SCORES = ["any", "green", "green_amber"];

  // нормализация ключевого слова: lower-case, без дефисов/пробелов/точек → "in-bond" ≡ "inbond" ≡ "IN BOND"
  function normKeyword(s) { return String(s || "").toLowerCase().replace(/[\s\-.]+/g, ""); }

  function num(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return (isFinite(n) && n >= 0) ? n : null;
  }
  // список строк: trim, обрезка, дедуп, лимит. map — доп. преобразование, keep — фильтр валидности
  function list(arr, map, keep) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (const v of arr) {
      let s = String(v == null ? "" : v).trim();
      if (map) s = map(s);
      if (!s || (keep && !keep(s)) || out.includes(s)) continue;
      out.push(s);
      if (out.length >= LIMITS.words) break;
    }
    return out;
  }
  const words = (arr) => list(arr, (s) => s.slice(0, LIMITS.word));
  const mcs = (arr) => list(arr, (s) => s.replace(/\D+/g, "").slice(0, LIMITS.mc));
  const states = (arr) => list(arr, (s) => s.toUpperCase(), (s) => /^[A-Z]{2}$/.test(s));

  function normalizeRule(r) {
    if (!r || typeof r !== "object" || !r.id) return null;
    const name = String(r.name || "").trim().slice(0, LIMITS.name);
    return {
      id: String(r.id).slice(0, LIMITS.id),
      name: name || "Rule",
      enabled: r.enabled !== false,
      keywordsAny: words(r.keywordsAny),
      keywordsNone: words(r.keywordsNone),
      minRate: num(r.minRate), minRpm: num(r.minRpm),
      maxDeadhead: num(r.maxDeadhead), minMiles: num(r.minMiles), maxMiles: num(r.maxMiles),
      equipment: EQ ? EQ.normalize(Array.isArray(r.equipment) ? r.equipment : null) : null,
      destStates: states(r.destStates),
      brokersAllow: mcs(r.brokersAllow), brokersBlock: mcs(r.brokersBlock),
      minCredit: num(r.minCredit),
      score: SCORES.includes(r.score) ? r.score : "any",
    };
  }

  // storage → канон. Любой мусор (старый формат, не объект) → пустой список правил.
  function normalize(raw) {
    const src = (raw && typeof raw === "object" && Array.isArray(raw.rules)) ? raw.rules : [];
    return { version: 1, rules: src.map(normalizeRule).filter(Boolean).slice(0, LIMITS.rules) };
  }

  function active(cfg) { return normalize(cfg).rules.filter((r) => r.enabled); }

  return { LIMITS, SCORES, normKeyword, normalize, active };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLRULES; }
if (typeof globalThis !== "undefined") globalThis.LLRULES = LLRULES;
