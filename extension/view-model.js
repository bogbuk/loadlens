/* LoadLens — view-model боковой панели. Чистый модуль: из состояния content.js строит
   сериализуемый снапшот (только данные, без HTML) для sidepanel.js. Кэши content.js приходят
   функциями в `look`, «сейчас» — числом `now`: тестируется без браузера.
   Форматтеры бейджей (profitText/crowdText/hosIcon) — отсюда же, чтобы тексты на странице и
   в панели не разъезжались. */
const LLVIEW = (() => {
  "use strict";
  const HOS_ICON = { green: "✓", amber: "!", red: "✕" };
  const hosIcon = (lvl) => HOS_ICON[lvl] || "?";
  const money = (n) => Math.round(n || 0).toLocaleString("en-US");
  const fmtAge = (m) => globalThis.LLMODEL.formatAge(m);

  function profitText(p) {
    if (!p || p.level === "unknown") return "— no rate";
    const rpm = p.netRpm != null ? "$" + p.netRpm.toFixed(2) + "/mi" : "—";
    const tag = p.level === "green" ? "▲ profitable" : p.level === "amber" ? "≈ marginal" : "▼ loss";
    return `${tag} · ${rpm}`;
  }
  function crowdText(rep) {
    if (!rep || !rep.n) return "👥 +review";
    if (rep.level === "bad") {
      const why = rep.doubleBrokered ? `${rep.doubleBrokered}× double-brokered` : `${rep.flaked}× flaked`;
      return `👥 ⚠ ${why} (${rep.n})`;
    }
    if (rep.level === "good") return `👥 ${rep.paid + rep.noIssue}/${rep.n} ok`;
    if (rep.level === "thin") return `👥 ${rep.n} ${rep.n === 1 ? "review" : "reviews"}`;
    return `👥 mixed (${rep.n})`;
  }
  function crowdShort(rep) {
    if (rep.level === "good") return "🛡 trusted";
    if (rep.level === "bad") return "⚠ risk";
    if (rep.level === "thin") return rep.n + (rep.n === 1 ? " review" : " reviews");
    return "mixed";
  }
  // bookingUrl приходит от брокера — допускаем только http/https (иначе javascript:/data: = XSS).
  function safeHttpUrl(raw) {
    if (!raw) return null;
    try { const u = new URL(String(raw)); return (u.protocol === "http:" || u.protocol === "https:") ? u.href : null; }
    catch { return null; }
  }
  function fmtPickup(av, now) {
    if (!av || !av.earliest) return null;
    const d = new Date(av.earliest);
    if (isNaN(d.getTime())) return null;
    if (d.toDateString() === new Date(now).toDateString()) return "today";
    return d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
  }
  function freshnessText(lastSeen, now) {
    if (!lastSeen) return "forecast";
    const d = new Date(lastSeen);
    if (isNaN(d.getTime())) return "forecast";
    const days = Math.floor((now - d.getTime()) / (1000 * 60 * 60 * 24));
    if (days <= 0) return "seen today";
    if (days === 1) return "seen yesterday";
    return `seen ${days}d ago`;
  }
  // Серверная свежесть (0..1) → цветная точка + слово. Бакеты как в спеке.
  function livenessLabel(liveness) {
    if (liveness > 0.66) return { dot: "🟢", word: "fresh" };
    if (liveness >= 0.33) return { dot: "🟡", word: "cooling" };
    return { dot: "🔴", word: "may be gone" };
  }
  function strengthBar(s) {
    const n = Math.max(0, Math.min(5, Math.round((s || 0) * 5)));
    return "▰".repeat(n) + "▱".repeat(5 - n);
  }
  // сигнатура цепочки = путь рынков (стабильна между рендерами) — ключ раскрытия в панели
  function chainSig(c) { return c.legs.map((l) => l.origin).concat(c.finalMarket).join(">") + "|" + c.chainNetRpm + "|" + c.totalMiles; }

  function liveChips(load, look, now) {
    const out = [];
    const age = look.age(load);
    // ≤30 мин — свежак (зелёный), ≥6 ч — почти наверняка уже взят или репост (янтарный)
    if (age != null) out.push({ text: "🕒 " + fmtAge(age), cls: age <= 30 ? "good" : age >= 360 ? "ok" : "" });
    const bn = load.brokerName ? load.brokerName + " · " : "";
    const rep = load.brokerMc ? look.rep(load.brokerMc) : null;
    if (rep && rep.n) {
      out.push({ text: bn + crowdShort(rep), cls: { good: "good", bad: "risk", mixed: "ok" }[rep.level] || "" });
    } else {
      const b = look.brokerBadge(load);
      if (b && b.level !== "unknown") {
        const cls = b.level === "good" ? "good" : b.level === "ok" ? "ok" : "risk";
        const tag = b.level === "good" ? "🛡 trusted" : b.level === "ok" ? "ok" : "⚠ risk";
        out.push({ text: bn + tag + (b.creditScore != null ? " " + b.creditScore + "CS" : ""), cls });
      }
    }
    const pick = fmtPickup(load.availability, now);
    if (pick) out.push({ text: "pickup " + pick, cls: "" });
    if (load.weight || load.lengthFt) {
      out.push({ text: [load.weight ? Math.round(load.weight / 1000) + "klb" : null, load.lengthFt ? load.lengthFt + "ft" : null].filter(Boolean).join(" · "), cls: "" });
    }
    if (load.isNegotiable) out.push({ text: "negotiable", cls: "" });
    if (load.isFactorable) out.push({ text: "factoring", cls: "" });
    if (load.bookNow) out.push({ text: "Book Now", cls: "book" });
    return out;
  }

  // одно плечо: live (груз в текущей выдаче) или forecast (крауд)
  function leg(lg, i, c, ctx, look) {
    const full = ctx.poolById.get(lg.loadId) || {};
    const rpm = (lg.loadedMiles + lg.deadhead) > 0 ? lg.rate / (lg.loadedMiles + lg.deadhead) : 0;
    const route = `${lg.origin} → ${lg.dest}`;
    const nbMi = full.originDeadheadMi > 0 ? Math.round(full.originDeadheadMi) : 0;
    if (ctx.liveIds.has(lg.loadId)) {
      return {
        kind: "live", resultId: full.resultId != null ? String(full.resultId) : null,
        idx: `leg ${i + 1} · ${lg.equipment || ""}`, route, nbMi,
        eco: `$${money(lg.rate)} · ${lg.loadedMiles}mi${lg.deadhead ? " +" + lg.deadhead + "dh" : ""} · $${rpm.toFixed(2)}/mi · HOS ${hosIcon(lg.hosBadge)}`,
        chips: liveChips(full, look, ctx.now),
      };
    }
    const median = look.laneMedianOf(lg.origin, lg.dest, lg.equipment);
    const rpmTxt = median != null ? `$${median.toFixed(2)}/mi lane median` : `$${rpm.toFixed(2)}/mi`;
    let fresh = freshnessText(full.lastSeen, ctx.now);
    if (full.liveness != null) { const ll = livenessLabel(full.liveness); fresh = `${ll.dot} ${ll.word} · ${fresh}`; }
    const density = look.density(lg.origin);
    const densTxt = density ? ` · ~${density} loads from market` : "";
    const strengthTxt = i === c.legs.length - 1 ? ` · dest. market ${strengthBar(look.strength(lg.dest))}` : "";
    return { kind: "forecast", route, nbMi, fresh, eco: `${rpmTxt}${densTxt}${strengthTxt} · HOS ${hosIcon(lg.hosBadge)}` };
  }

  function chain(c, ctx, look) {
    const h = globalThis.LLPLAN.horizon(c);
    return {
      sig: chainSig(c), hos: c.hosBadge || "red",
      path: c.legs.map((l) => l.origin).concat(c.finalMarket).join(" → "),
      meta: `$${c.chainNetRpm.toFixed(2)}/mi · net $${c.totalNet} · ~${h.days}d · $${h.perDay}/day · HOS ${hosIcon(c.hosBadge)}`,
      legs: c.legs.map((l, i) => leg(l, i, c, ctx, look)),
    };
  }

  function deal(d, look) {
    const age = look.age(d.l);
    return { loadId: String(d.l.loadId), lane: `${d.l.originMarket} → ${d.l.destMarket} ${d.l.equipment}`, age: age != null ? fmtAge(age) : null, rpm: d.b.netRpm.toFixed(2) };
  }

  function fleetLine(x) {
    return `${x.feasible ? "✓" : "✕"} ${x.name} · HOS ${x.hosBadge}${x.equipMatch ? "" : " · equipment mismatch"} · DH ${x.deadhead}mi` +
      `${x.netRpm != null ? " · $" + x.netRpm.toFixed(2) + "/mi" : ""}`;
  }

  function detail(load, f) {
    const rows = [];
    const add = (k, v, href) => rows.push(href ? { k, v, href } : { k, v });
    add("Rate", load.rate != null ? `$${load.rate.toLocaleString("en-US")}${load.rateBasis ? " (" + load.rateBasis + ")" : ""}` : "—");
    add("RPM", [
      f.trueRpm != null ? `true $${f.trueRpm.toFixed(2)}` : null,
      f.profit && f.profit.netRpm != null ? `net $${f.profit.netRpm.toFixed(2)}` : null,
      load.estimatedRatePerMile != null ? `DAT est $${Number(load.estimatedRatePerMile).toFixed(2)}` : null,
      f.laneMedian != null ? `market $${f.laneMedian.toFixed(2)}` : null,
    ].filter(Boolean).join(" · ") || "—");
    add("Miles", `${load.loadedMiles ?? "—"} loaded · ${load.deadheadMiles ?? 0} DH`);
    if (load.weight) add("Weight", `${load.weight.toLocaleString("en-US")} lbs`);
    if (load.availability) add("Available", `${load.availability.earliest || "?"} – ${load.availability.latest || "?"}`);
    const flagTag = f.flags.length ? " · 🚩 " + (f.flagLevel === "high" ? "risk" : "verify") : "";
    add("Score", `${profitText(f.profit)} · HOS ${hosIcon(f.hos)}${flagTag}`);
    if (f.offer && f.offer.ask != null) add("Ask", f.offer.script);
    const b = f.broker || {};
    add("Broker", [load.brokerName, load.brokerMc ? "MC " + load.brokerMc : null,
      b.creditScore != null ? b.creditScore + " CS" : null, b.daysToPay != null ? b.daysToPay + " DTP" : null,
      f.rep && f.rep.n ? "crowd: " + crowdText(f.rep).replace("👥 ", "") : null].filter(Boolean).join(" · ") || "—");
    if (load.contactPhone) add("Phone", load.contactPhone, "tel:" + load.contactPhone);
    if (load.contactEmail) add("Email", load.contactEmail, "mailto:" + load.contactEmail);

    // Ведущая кнопка контакта — по preferredContactMethod (брокер сам указал канал).
    const phonePreferred = String(load.preferredContactMethod || "").indexOf("PHONE") >= 0;
    const book = safeHttpUrl(load.bookingUrl);
    const hasMail = !!(f.mail && load.contactEmail);
    const script = f.offer && f.offer.script;
    const copy = `${load.originMarket} → ${load.destMarket} ${load.equipment}\n` +
      `Rate: $${load.rate ?? "?"} ${load.rateBasis || ""} | ${load.loadedMiles ?? "?"}mi +${load.deadheadMiles ?? 0}DH\n` +
      (f.trueRpm != null ? `RPM: true $${f.trueRpm.toFixed(2)}${f.laneMedian != null ? ` | market $${f.laneMedian.toFixed(2)}` : ""}\n` : "") +
      (script ? `Ask: ${script}\n` : "") +
      `Broker: ${load.brokerName || "?"} MC ${load.brokerMc || "?"} | ${load.creditScore ?? "?"} CS ${load.daysToPay ?? "?"} DTP\n` +
      (load.contactPhone ? `Tel: ${load.contactPhone}\n` : "") + (load.comments ? `Notes: ${load.comments}` : "");
    return {
      loadId: String(load.loadId),
      title: `${load.originMarket} → ${load.destMarket} · ${load.equipment}`,
      rows, flags: f.flags.map((x) => x.label), comments: load.comments || null,
      fleet: f.fleet ? { title: `Fits drivers (${f.fleet.feasibleCount}/${f.fleet.total})`, rows: f.fleet.matches.map((x) => ({ ok: !!x.feasible, text: fleetLine(x) })) } : null,
      actions: {
        book: book ? { url: book, label: load.bookNow ? "Book Now ↗" : "Open ↗" } : null,
        mail: hasMail ? { url: f.mail.url, primary: !phonePreferred } : null,
        call: load.contactPhone ? { href: "tel:" + load.contactPhone, primary: phonePreferred || !load.contactEmail } : null,
        copyEmail: hasMail ? f.mail.text : null,
        copy,
        brokerMc: load.brokerMc ? String(load.brokerMc) : null,
      },
    };
  }

  function build(i) {
    const ctx = { poolById: new Map(i.pool.map((l) => [l.loadId, l])), liveIds: new Set(i.loads.map((l) => l.loadId)), now: i.now };
    return {
      board: i.board,
      hintsOff: !!i.hintsOff,
      header: {
        loadsCount: i.loads.length,
        equipFilter: i.equipFilter && i.equipFilter.length ? i.equipFilter.join(", ") : null,
        start: i.start || null,
        diesel: Number(i.dieselPrice).toFixed(2),
        cpm: i.costPerMile,
        autoRefresh: { on: !!i.autoRefreshOn, cloud: !!i.cloud },
        sseLive: !!i.sseLive,
        sort: { field: (i.sortPref && i.sortPref.field) || "", dir: i.sortPref && i.sortPref.dir === "asc" ? "asc" : "desc" },
        sortFields: i.sortFields.map((s) => ({ field: s.field, label: s.label })),
        drivers: i.drivers.map((d) => ({ id: String(d.id), label: d.name + (d.currentMarket ? " · " + d.currentMarket : "") + (d.equipment ? " · " + d.equipment : "") })),
        activeDriverId: i.activeDriverId != null ? String(i.activeDriverId) : null,
      },
      chains: i.chains.map((c) => chain(c, ctx, i.look)),
      deals: i.deals.map((d) => deal(d, i.look)),
      detail: i.detailLoad && i.detailFacts ? detail(i.detailLoad, i.detailFacts) : null,
    };
  }

  return { build, profitText, crowdText, hosIcon, safeHttpUrl };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLVIEW; }
if (typeof globalThis !== "undefined") globalThis.LLVIEW = LLVIEW;
