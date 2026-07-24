/* AUTO-GENERATED копия из /shared — НЕ РЕДАКТИРОВАТЬ. Источник правды: shared/. Пересобрать: npm run sync:shared */
/* LoadLens — шаблон письма брокеру (чистые функции). Zero-dep CommonJS: браузер + Node + тесты.
   Только prefill: собираем текст и Gmail compose-URL, отправляет пользователь сам. */
const LLMAIL = (() => {
  "use strict";

  const EM_DASH = "—"; // фолбэк для отсутствующего поля: в письмо не должно попасть undefined/null
  // Поля внутри связного текста, где «—» читается по-человечески плохо («Hi —,»).
  const PROSE_FALLBACK = { brokerName: "there" };

  const DEFAULT_TEMPLATE = [
    "Hi {{brokerName}},",
    "",
    "I'm interested in your load {{origin}} → {{dest}} ({{equipment}}, {{loadedMiles}} mi), pickup {{pickupDate}}.",
    "{{counterOffer}}",
    "Is it still available? I can send my MC and COI right away.",
    "",
    "Thanks,",
    "{{driverName}}",
  ].join("\n");

  const money = (n) => (n == null || n === "" ? null : "$" + Math.round(Number(n)).toLocaleString("en-US"));

  // Значения плейсхолдеров. null/undefined/"" считаются пустыми; 0 — валидное значение.
  function valuesFor(load, driver, extras) {
    const l = load || {}, d = driver || {}, e = extras || {};
    const total = (l.loadedMiles || 0) + (l.deadheadMiles || 0);
    const rpm = l.rate && total > 0 ? "$" + (Number(l.rate) / total).toFixed(2) : null;
    return {
      origin: l.originMarket, dest: l.destMarket, equipment: l.equipment,
      rate: money(l.rate), rateBasis: l.rateBasis,
      // 0 груженых миль = дистанция неизвестна («0 mi» в письме — мусор); 0 deadhead — валидные данные
      loadedMiles: l.loadedMiles || null, deadheadMiles: l.deadheadMiles, trueRpm: rpm,
      brokerName: l.brokerName, brokerMc: l.brokerMc,
      pickupDate: l.availability ? l.availability.earliest : null,
      driverName: d.name, counterOffer: e.counterOffer,
    };
  }

  const isEmpty = (v) => v == null || String(v).trim() === "";
  const PLACEHOLDER = /\{\{(\w+)\}\}/g;
  const ONLY_PLACEHOLDER = /^\s*\{\{(\w+)\}\}\s*$/;

  // Подстановка. Строка, состоящая ТОЛЬКО из пустого плейсхолдера, выбрасывается целиком
  // (так исчезает строка контр-оффера, когда цену посчитать не из чего).
  // Пустое/неизвестное поле внутри осмысленной строки → «—».
  function fillTemplate(tpl, load, driver, extras) {
    const vals = valuesFor(load, driver, extras);
    const kept = String(tpl == null ? "" : tpl).split("\n").filter((line) => {
      const solo = line.match(ONLY_PLACEHOLDER);
      return !(solo && isEmpty(vals[solo[1]]));
    });
    return kept.join("\n").replace(PLACEHOLDER, (_, key) =>
      (isEmpty(vals[key]) ? (PROSE_FALLBACK[key] || EM_DASH) : String(vals[key])));
  }

  function subjectFor(load) {
    const l = load || {};
    const lane = [l.originMarket, l.destMarket].filter(Boolean).join(" → ");
    return "Load inquiry: " + (lane || EM_DASH) + (l.equipment ? ` (${l.equipment})` : "");
  }

  // Штатный compose-URL Gmail: открывает окно письма с заполненными полями, Send жмёт пользователь.
  function gmailComposeUrl(to, subject, body) {
    const q = (v) => encodeURIComponent(v == null ? "" : String(v));
    return "https://mail.google.com/mail/?view=cm&fs=1" +
      `&to=${q(to)}&su=${q(subject)}&body=${q(body)}`;
  }

  return { DEFAULT_TEMPLATE, fillTemplate, subjectFor, gmailComposeUrl };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LLMAIL;
if (typeof globalThis !== "undefined") globalThis.LLMAIL = LLMAIL;
