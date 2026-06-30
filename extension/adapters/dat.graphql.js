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

  // comments в реальном ответе DAT — МАССИВ строк (в синтетике была строка). Нормализуем к строке.
  function normComments(c) {
    if (c == null) return null;
    if (Array.isArray(c)) {
      const s = c.map((x) => String(x).trim()).filter(Boolean).join(" · ");
      return s || null;
    }
    const s = String(c).trim();
    return s || null;
  }

  // poster.contactMethods[] → нормализованные email/phone (структурный канал контакта).
  // Реальная схема: { method, value: { emailAddress | countryCode/extension/number } }.
  // Это PII — НЕ уходит в крауд (sanitizeLoad режет), используется локально (карточка/preferred-канал).
  function extractContacts(poster) {
    const out = { email: null, phone: null, methods: [], preferred: poster.preferredContactMethod || null };
    const list = Array.isArray(poster.contactMethods) ? poster.contactMethods : [];
    for (const m of list) {
      const v = (m && m.value) || {};
      const type = String(v.__typename || "");
      if (type === "EmailInfo" || v.emailAddress) {
        const e = v.emailAddress || null;
        if (e && !out.email) out.email = e;
        out.methods.push({ method: m.method || "EMAIL", email: e });
      } else if (type === "PhoneInfo" || v.number != null) {
        const num = v.number != null ? String(v.number) : null;
        if (num && !out.phone) out.phone = num;
        out.methods.push({ method: m.method || "PHONE", phone: num });
      }
    }
    return out;
  }

  // один FreightSearchV4FindLoadsResult → unified Load (+ broker-trust поля)
  function mapResult(result) {
    if (!result || !result.assetInfo) return null;
    const a = result.assetInfo;
    const o = point(a.origin), d = point(a.destination);
    const cap = a.capacity || {};
    const poster = result.posterInfo || {};
    const dot = result.posterDotIds || {};
    const credit = poster.credit || {};
    const ri = result.rateInfo || {};
    const contact = poster.contact || {};
    const phone = contact.phone || {};
    // структурный contactMethods[] (новее legacy contact), с фолбэком на legacy contact.*
    const cm = extractContacts(poster);
    const email = contact.email || cm.email || null;
    const phoneNum = (phone.number != null ? String(phone.number) : null) || cm.phone || null;

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
      contact: email || phoneNum, // PII → режется в sanitizeLoad
    }, "dat");
    if (!load) return null;

    load.resultId = result.resultId ?? null;   // ключ матчинга с DOM-строкой (id="table-row-<resultId>")
    // broker-trust + рыночные подсказки (не PII): остаются для скоринга/бейджей
    load.estimatedRatePerMile = result.estimatedRatePerMile ?? null;
    load.creditScore = credit.creditScore ?? null;
    load.daysToPay = credit.daysToPay ?? null;
    load.creditAsOf = credit.asOf ?? null;              // дата актуальности кредит-данных
    load.isFactorable = !!result.isFactorable;
    load.isAssurable = !!result.isAssurable;            // DAT Assurance (гарантия оплаты) — trust-сигнал
    load.isNegotiable = !!result.isNegotiable;
    load.hasTiaMembership = !!poster.hasTiaMembership;  // членство в TIA — broker-trust сигнал
    load.fromPrivateNetwork = !!result.isFromPrivateNetwork;
    load.servicedWhen = result.servicedWhen || null;          // когда пост был обновлён (свежесть)
    load.postingExpiresWhen = result.postingExpiresWhen || null;
    load.presentationDate = result.presentationDate || null;

    // equipment: сохраняем СЫРОЙ гранулярный код DAT рядом с нормализованной группой (ничего не теряем)
    load.equipmentCode = a.equipmentType || null;
    load.fullPartial = cap.fullPartial || null;               // FULL / PARTIAL / BOTH
    load.tripMethod = (result.tripLength && result.tripLength.method) || null; // ROAD / PCMILER
    load.destDeadheadMiles = (result.destinationDeadheadMiles && result.destinationDeadheadMiles.miles) ?? null;

    // идентификаторы постера/офиса (не PII) — для дедупа/идентичности брокера
    load.dotNumber = dot.dotNumber ?? null;
    load.carrierMc = dot.carrierMcNumber ?? null;
    load.freightForwarderMc = dot.freightForwarderMcNumber ?? null;
    load.combinedOfficeId = result.combinedOfficeId ?? null;
    load.headquartersId = poster.headquartersId ?? null;
    load.posterUserId = poster.userId ?? null;

    // booking / конкуренция / обфускация
    load.bidCount = Array.isArray(result.bids) ? result.bids.length : 0;
    load.isObfuscated = !!result.isObfuscated;
    load.redactionReasons = result.redactionReasons || null;
    load.unmetPreferences = result.unmetPreferences || null;

    // поля для карточки детали (локально; contact-PII не уходит на сервер — sanitizeLoad его не берёт)
    const bk = ri.bookable || {};
    load.rateBasis = (bk.rate && bk.rate.basis) || (ri.nonBookable && ri.nonBookable.basis) || null;
    load.bookingUrl = bk.bookingUrl || null;
    load.bookingMethod = bk.bookingMethod || null;            // BOOK_NOW / ...
    load.bookNow = !!(result.integrations && result.integrations.bookNow);
    load.comments = normComments(result.comments);
    load.availability = result.availability
      ? { earliest: result.availability.earliestWhen || null, latest: result.availability.latestWhen || null }
      : null;
    load.brokerCity = poster.city || null;
    load.brokerState = poster.state || null;
    load.contactEmail = email;
    load.contactPhone = phoneNum;
    load.preferredContactMethod = cm.preferred;        // PRIMARY_PHONE / EMAIL / ...
    load.contactMethods = cm.methods.length ? cm.methods : null; // структурные каналы (PII, локально)
    return load;
  }

  // Полный ответ FindLoads → { loads, searchId, hasNext }. Толерантен к форме/ошибкам.
  // searchId одинаков для всех страниц одного поиска (пагинация/fetchMore), меняется на новый поиск —
  // это сигнал accumulate-vs-reset для авто-скролла (см. loads-accumulator.js). hasNext = есть курсор.
  function parseFindLoadsResult(json) {
    const fl = json && json.data && json.data.freightSearchV4 && json.data.freightSearchV4.findLoads;
    if (!fl || (fl.__typename && fl.__typename !== "FreightSearchV4FindLoadsSuccess"))
      return { loads: [], searchId: null, hasNext: false };
    const rows = []
      .concat(fl.results || [])
      .concat(fl.similarResults || []);
    const seen = new Set(), out = [];
    for (const r of rows) {
      const load = mapResult(r);
      if (!load) continue;
      if (seen.has(load.loadId)) continue;   // дедуп по postingId (внутри одного ответа)
      seen.add(load.loadId);
      out.push(load);
    }
    return { loads: out, searchId: fl.searchId || null, hasNext: !!(fl.cursors && fl.cursors.next) };
  }

  // Обратносовместимая обёртка: только Load[] (потребители, которым searchId не нужен).
  function parseFindLoads(json) { return parseFindLoadsResult(json).loads; }

  // Это FindLoads-ответ? (для перехватчика сети)
  function isFindLoadsResponse(json) {
    return !!(json && json.data && json.data.freightSearchV4 && json.data.freightSearchV4.findLoads);
  }

  return { parseFindLoads, parseFindLoadsResult, mapResult, resolveRate, isFindLoadsResponse };
})();

if (typeof module !== "undefined" && module.exports) module.exports = DAT_GQL;
if (typeof globalThis !== "undefined") globalThis.DAT_GQL = DAT_GQL;
