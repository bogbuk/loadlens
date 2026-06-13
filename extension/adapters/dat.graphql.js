/* LoadLens — парсер GraphQL-ответа DAT One (operation FindLoads, freightSearchV4).
   ВАЖНО (ToS): мы НЕ вызываем API DAT сами. Этот модуль разбирает ответ, который приложение DAT
   уже загрузило в сессии пользователя (перехват в inject.js). То же «читаем, что пользователь видит»,
   что и DOM-адаптер, но по стабильной схеме API вместо хрупких CSS-селекторов.

   Схема снята с реального запроса datone.web (FreightSearchV4FindLoadsResult). Грузится после
   load.model.js. PII (email/phone) попадает в Load.contact, но режется LLAPI.sanitizeLoad до отправки;
   brokerMc / creditScore / daysToPay — бизнес-данные, остаются (это broker-trust слой). */
const DAT_GQL = (() => {
  "use strict";

  // rateUsd + basis → ставка в $. FLAT = тотал; PER_MILE = умножаем на trip miles.
  function resolveRate(result) {
    const ri = result.rateInfo || {};
    const r = (ri.bookable && ri.bookable.rate) || ri.nonBookable || null;
    if (!r || r.rateUsd == null) return null;
    const basis = String(r.basis || "").toUpperCase();
    if (basis.includes("MILE")) {
      const miles = result.tripLength && result.tripLength.miles;
      return miles ? Math.round(r.rateUsd * miles) : null;
    }
    return Math.round(r.rateUsd); // FLAT / тотал
  }

  function point(p) { return p || {}; }

  // один FreightSearchV4FindLoadsResult → unified Load (+ broker-trust поля)
  function mapResult(result) {
    if (!result || !result.assetInfo) return null;
    const a = result.assetInfo;
    const o = point(a.origin), d = point(a.destination);
    const cap = a.capacity || {};
    const poster = result.posterInfo || {};
    const dot = result.posterDotIds || {};
    const credit = poster.credit || {};
    const contact = poster.contact || {};
    const phone = contact.phone || {};

    const load = (typeof LLMODEL !== "undefined" ? LLMODEL.buildLoad : globalThis.LLMODEL.buildLoad)({
      loadId: a.postingId || result.resultId,
      originCity: o.city, originState: o.stateProv,
      destCity: d.city, destState: d.stateProv,
      equipment: a.equipmentType,
      rate: resolveRate(result),
      loadedMiles: result.tripLength && result.tripLength.miles,
      deadheadMiles: result.originDeadheadMiles && result.originDeadheadMiles.miles,
      weight: cap.maximumWeightPounds,
      lengthFt: cap.maximumLengthFeet,
      brokerMc: dot.brokerMcNumber || dot.carrierMcNumber || null,
      brokerName: poster.companyName,
      contact: contact.email || (phone.number ? String(phone.number) : null), // PII → режется в sanitizeLoad
    }, "dat");
    if (!load) return null;

    load.resultId = result.resultId ?? null;   // ключ матчинга с DOM-строкой (id="table-row-<resultId>")
    // broker-trust + рыночные подсказки (не PII): остаются для скоринга/бейджей
    load.estimatedRatePerMile = result.estimatedRatePerMile ?? null;
    load.creditScore = credit.creditScore ?? null;
    load.daysToPay = credit.daysToPay ?? null;
    load.isFactorable = !!result.isFactorable;
    load.isNegotiable = !!result.isNegotiable;
    load.fromPrivateNetwork = !!result.isFromPrivateNetwork;
    return load;
  }

  // Полный ответ FindLoads → Load[] (results + similarResults). Толерантен к форме/ошибкам.
  function parseFindLoads(json) {
    const fl = json && json.data && json.data.freightSearchV4 && json.data.freightSearchV4.findLoads;
    if (!fl || (fl.__typename && fl.__typename !== "FreightSearchV4FindLoadsSuccess")) return [];
    const rows = []
      .concat(fl.results || [])
      .concat(fl.similarResults || []);
    const seen = new Set(), out = [];
    for (const r of rows) {
      const load = mapResult(r);
      if (!load) continue;
      if (seen.has(load.loadId)) continue;   // дедуп по postingId
      seen.add(load.loadId);
      out.push(load);
    }
    return out;
  }

  // Это FindLoads-ответ? (для перехватчика сети)
  function isFindLoadsResponse(json) {
    return !!(json && json.data && json.data.freightSearchV4 && json.data.freightSearchV4.findLoads);
  }

  return { parseFindLoads, mapResult, resolveRate, isFindLoadsResponse };
})();

if (typeof module !== "undefined" && module.exports) module.exports = DAT_GQL;
if (typeof globalThis !== "undefined") globalThis.DAT_GQL = DAT_GQL;
