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

  // Груз проходит правило, если все ЗАДАННЫЕ условия выполнены. ctx.badgeFor — ленивый скоринг
  // (вызывается только при score !== "any"), ctx.equipFilter — глобальный фильтр прицепа.
  function matches(rule, load, ctx) {
    ctx = ctx || {};
    if (!rule || !load) return false;
    const eqFilter = (rule.equipment && rule.equipment.length) ? rule.equipment : (ctx.equipFilter || null);
    if (EQ && !EQ.matches(eqFilter, load.equipment)) return false;

    const text = normKeyword(load.comments);
    if (rule.keywordsAny.length && !(text && rule.keywordsAny.some((w) => text.includes(normKeyword(w))))) return false;
    if (rule.keywordsNone.length && text && rule.keywordsNone.some((w) => text.includes(normKeyword(w)))) return false;

    const rate = Number(load.rate) || 0;
    const miles = Number(load.loadedMiles) || 0;
    const dh = Number(load.deadheadMiles) || 0;          // null → 0: без DH-миль груз не выпадает
    if (rule.minRate != null && rate < rule.minRate) return false;
    if (rule.minRpm != null) {
      const total = miles + dh;                            // та же формула, что LLSCORE.trueRpm
      if (!(total > 0) || rate / total < rule.minRpm) return false;
    }
    if (rule.maxDeadhead != null && dh > rule.maxDeadhead) return false;
    if (rule.minMiles != null && miles < rule.minMiles) return false;
    if (rule.maxMiles != null && miles > rule.maxMiles) return false;

    if (rule.destStates.length) {
      const st = String(load.destMarket || "").split("_").pop();
      if (!st || !rule.destStates.includes(st)) return false;
    }

    const mc = String(load.brokerMc || "").replace(/\D+/g, "");
    if (rule.brokersBlock.length && mc && rule.brokersBlock.includes(mc)) return false;
    if (rule.brokersAllow.length && !rule.brokersAllow.includes(mc)) return false;
    if (rule.minCredit != null) {
      const c = load.creditScore == null ? NaN : Number(load.creditScore);
      if (isNaN(c) || c < rule.minCredit) return false;
    }

    if (rule.score !== "any") {
      const b = typeof ctx.badgeFor === "function" ? ctx.badgeFor(load) : null;
      const lvl = b && b.level;
      if (rule.score === "green" && lvl !== "green") return false;
      if (rule.score === "green_amber" && lvl !== "green" && lvl !== "amber") return false;
    }
    return true;
  }

  // Для каждого груза — первое совпавшее правило. Несовпавшие выпадают.
  function select(rules, loads, ctx) {
    const out = [];
    for (const load of (Array.isArray(loads) ? loads : [])) {
      const r = (rules || []).find((rule) => matches(rule, load, ctx));
      if (r) out.push({ load, rule: r });
    }
    return out;
  }

  return { LIMITS, SCORES, normKeyword, normalize, active, matches, select };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLRULES; }
if (typeof globalThis !== "undefined") globalThis.LLRULES = LLRULES;
