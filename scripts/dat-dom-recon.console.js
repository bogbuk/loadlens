/* LoadLens — DOM-разведка строк DAT One. ВСТАВИТЬ В КОНСОЛЬ DevTools на залогиненной
   странице one.dat.com/search-loads ПОСЛЕ того, как появились результаты поиска.
   Ничего не отправляет наружу — только печатает кандидатов селекторов строк + где лежит postingId.
   Скопируй вывод (LL-RECON ...) и пришли в чат — по нему обновим dat.adapter.js DAT_SELECTORS. */
(() => {
  const stateRe = /,\s*[A-Z]{2}\b/;        // "Chicago, IL"
  const moneyRe = /\$\s?\d|\d\.\d{2}\s*\/?\s*mi/i;
  const idRe = /\b\d{6,}\b/;                // posting id обычно 6+ цифр

  // сигнатура элемента: angular-компонент (tag с дефисом) | data-test | tag.первый-класс
  function sig(el) {
    const dt = el.getAttribute("data-test") || el.getAttribute("data-testid");
    if (dt) return `[data-test="${dt.replace(/\d+/g, "")}"]`;
    const tag = el.tagName.toLowerCase();
    if (/-/.test(tag)) return tag;                       // <load-row>, <freight-result> и т.п.
    const cls = (el.getAttribute("class") || "").trim().split(/\s+/)
      .filter((c) => c && !/\d{3,}|ng-|cdk-|mat-ripple/.test(c)).slice(0, 2).join(".");
    return cls ? `${tag}.${cls}` : null;
  }

  // ищем повторяющиеся блоки, похожие на строки груза (есть ", ST" и $/мили)
  const groups = {};
  for (const el of document.querySelectorAll("body *")) {
    const t = el.innerText || "";
    if (t.length < 12 || t.length > 600 || !stateRe.test(t)) continue;
    const s = sig(el);
    if (!s) continue;
    (groups[s] = groups[s] || []).push(el);
  }

  const cands = Object.entries(groups)
    .map(([s, els]) => ({ s, n: els.length, money: els.filter((e) => moneyRe.test(e.innerText)).length, els }))
    .filter((c) => c.n >= 4)
    .sort((a, b) => (b.money - a.money) || (b.n - a.n))
    .slice(0, 5);

  console.log("%cLL-RECON: кандидаты строк (по убыванию похожести)", "font-weight:bold;color:#1d4ed8");
  cands.forEach((c, i) => {
    const sample = c.els[Math.floor(c.els.length / 2)];
    // где может лежать postingId: data-* атрибуты или href со ссылкой
    const attrs = [...sample.attributes].filter((a) => idRe.test(a.value)).map((a) => `${a.name}="${a.value}"`);
    const links = [...sample.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).filter((h) => idRe.test(h)).slice(0, 3);
    console.log(`\n#${i + 1}  selector: ${c.s}   (count=${c.n}, withMoney=${c.money})`);
    console.log("   sampleText:", (sample.innerText || "").slice(0, 160).replace(/\n/g, " | "));
    console.log("   id-атрибуты строки:", attrs.length ? attrs : "(нет — ищи postingId в дочерней ссылке/кнопке)");
    console.log("   ссылки с цифрами:", links.length ? links : "(нет)");
    console.log("   outerHTML (обрезан 1500):\n", sample.outerHTML.slice(0, 1500));
  });
  if (!cands.length) console.warn("LL-RECON: строки не найдены — убедись, что результаты поиска прогрузились.");
  return `LL-RECON: найдено кандидатов ${cands.length}. Скопируй блок выше и пришли в чат.`;
})();
