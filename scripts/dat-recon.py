#!/usr/bin/env python3
"""Подключается к запущенному Chrome по CDP (порт 9222, твоя залогиненная DAT-сессия),
открывает search-loads, ждёт рендер и эвристически находит разметку строк грузов:
скриншот + кандидаты row-селекторов + пример outerHTML строки и её ячеек.
Запуск: python3 scripts/dat-recon.py"""
from playwright.sync_api import sync_playwright
import json, re

CDP = "http://localhost:9222"
URL = "https://one.dat.com/search-loads"

JS_FIND_ROWS = r"""
() => {
  // Группируем элементы по сигнатуре (tag + data-test|роль|первый класс-паттерн),
  // ищем повторяющиеся блоки, похожие на строки грузов (есть ", ST" и $/мили).
  const all = Array.from(document.querySelectorAll('body *'));
  const stateRe = /,\s*[A-Z]{2}\b/;        // "Chicago, IL"
  const moneyRe = /\$\s?\d/;
  function sig(el) {
    const dt = el.getAttribute('data-test') || el.getAttribute('data-testid');
    if (dt) return 'attr:[data-test*="' + dt.replace(/\d+/g,'') + '"]';
    const tag = el.tagName.toLowerCase();
    if (/^[a-z]+-[a-z-]+$/.test(tag)) return 'tag:' + tag;     // angular component selector
    const cls = (el.getAttribute('class')||'').trim().split(/\s+/)
       .filter(c=>c && !/\d{3,}|active|selected|ng-/.test(c)).slice(0,2).join('.');
    return cls ? 'css:' + tag + '.' + cls : null;
  }
  const groups = {};
  for (const el of all) {
    const txt = el.innerText || '';
    if (txt.length < 12 || txt.length > 400) continue;
    if (!stateRe.test(txt)) continue;
    const s = sig(el);
    if (!s) continue;
    (groups[s] = groups[s] || []).push(el);
  }
  const out = [];
  for (const [s, els] of Object.entries(groups)) {
    if (els.length < 4) continue;                 // строк обычно много
    const sample = els[Math.floor(els.length/2)];
    const hasMoney = els.filter(e=>moneyRe.test(e.innerText)).length;
    out.push({
      signature: s, count: els.length, withMoney: hasMoney,
      sampleText: (sample.innerText||'').slice(0,200).replace(/\n/g,' | '),
      sampleHtml: sample.outerHTML.slice(0, 2500),
    });
  }
  out.sort((a,b)=> (b.withMoney - a.withMoney) || (b.count - a.count));
  return { url: location.href, title: document.title, candidates: out.slice(0,6) };
}
"""

def main():
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP)
        ctx = browser.contexts[0] if browser.contexts else browser.new_context()
        # ищем уже открытую вкладку DAT, иначе открываем новую в том же контексте (куки/сессия общие)
        page = None
        for pg in ctx.pages:
            if "dat.com" in pg.url:
                page = pg; break
        if page is None:
            page = ctx.new_page()
        if "search-loads" not in page.url:
            page.goto(URL, wait_until="domcontentloaded")
        try:
            page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass
        page.wait_for_timeout(3000)
        page.screenshot(path="/tmp/dat-recon.png", full_page=False)
        res = page.evaluate(JS_FIND_ROWS)
        print("URL:", res["url"])
        print("TITLE:", res["title"])
        print("=== ROW CANDIDATES (по убыванию похожести на строки грузов) ===")
        for i, c in enumerate(res["candidates"], 1):
            print(f"\n--- #{i}  {c['signature']}  (count={c['count']}, withMoney={c['withMoney']}) ---")
            print("text:", c["sampleText"])
            print("html:", c["sampleHtml"])
        browser.close()

if __name__ == "__main__":
    main()
