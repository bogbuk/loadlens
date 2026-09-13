"""E2E-прогон редактора правил Telegram-алертов в попапе расширения (без юнит-тестов у popup.js).

Поднимает Chromium (Playwright) с распакованным расширением из extension/, мокает backend
(аккаунт Pro, Telegram привязан) и гоняет сценарий: пустое состояние → два правила (как у лида:
keywords + «≥ $8/mi») → persist через перезагрузку попапа → edit / cancel → тумблер → delete →
Free-аккаунт (редактор скрыт). Скриншоты и профиль — во временной папке.

Запуск: npm run e2e:popup   (нужен `pip install playwright && playwright install chromium`)
"""
import hashlib
import json
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EXT = str(ROOT / "extension")
OUT = Path(tempfile.mkdtemp(prefix="loadlens-popup-e2e-"))
PROFILE = str(OUT / "chrome-profile")
BACKEND = "https://loadlens.krait.studio"  # LL_BACKEND по умолчанию в api.js; сеть перехватывается целиком

errors, console, results = [], [], []


def check(name, cond, extra=""):
    results.append((name, bool(cond), extra))
    print(("PASS " if cond else "FAIL ") + name + (f" — {extra}" if extra else ""))


def unpacked_id(path):
    """ID распакованного расширения: sha256(путь)[:32] в алфавите a..p (как считает Chrome)."""
    h = hashlib.sha256(path.encode()).hexdigest()[:32]
    return "".join(chr(ord("a") + int(c, 16)) for c in h)


def mock(route, request):
    url = request.url
    body = {}
    if "/telegram/status" in url:
        body = {"configured": True, "linked": True, "enabled": True}
    elif "/telegram/alerts" in url:
        body = {"enabled": json.loads(request.post_data or "{}").get("enabled")}
    elif "/drivers" in url:
        body = []
    elif "/auth/me" in url:
        body = {"email": "demo@loadlens.test", "plan": "pro"}
    elif "/rates" in url:
        body = {"diesel": 3.95}
    route.fulfill(status=200, content_type="application/json", body=json.dumps(body))


def stored_rules(page):
    return page.evaluate("() => chrome.storage.local.get('ll_alert_rules').then(r => r.ll_alert_rules)")


def set_auth(page, plan, email):
    page.evaluate(
        "([plan, email]) => chrome.storage.local.set({ ll_auth: { email, plan, planTs: Date.now(),"
        " accessToken: 'test-access', refreshToken: 'test-refresh' }, ll_alert_rules: null })",
        [plan, email],
    )


with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        PROFILE, channel="chromium", headless=True,
        args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"],
        viewport={"width": 420, "height": 900},
    )
    ctx.route(f"{BACKEND}/**", mock)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: console.append(f"[{m.type}] {m.text}"))

    popup = f"chrome-extension://{unpacked_id(EXT)}/popup.html"
    page.goto(popup)
    page.wait_for_load_state("networkidle")
    set_auth(page, "pro", "demo@loadlens.test")  # getMe отдаст кэш plan без сети
    page.reload()
    page.wait_for_load_state("networkidle")
    page.wait_for_selector("#tg-rules h4", timeout=10000)
    check("секция Alert rules отрисована", page.locator("#tg-rules h4").inner_text().lower() == "alert rules")
    check("пустое состояние: подсказка «No rules»", "No rules" in page.locator("#tg-rules").inner_text())
    page.screenshot(path=str(OUT / "01-empty.png"), full_page=True)

    # ---- правило 1: ключевые слова (как у лида) ----
    page.click("#rule-add")
    page.wait_for_selector("#rf-name")
    check("при открытой форме подсказка «No rules» скрыта", "No rules" not in page.locator("#tg-rules").inner_text())
    page.fill("#rf-name", "Bonded / TSA / Canada")
    page.fill("#rf-any", "bonded, in-bond, TWIC, cross-border, Canada, Canadian bonded, airport pickup, TSA, expedited, secure")
    page.fill("#rf-none", "hazmat, team")
    page.fill("#rf-dh", "150")
    page.click("#rf-equip .chip[data-code='V']")
    page.fill("#rf-states", "TX, OK, ON")
    page.select_option("#rf-score", "any")
    page.screenshot(path=str(OUT / "02-form-filled.png"), full_page=True)
    page.click("#rf-save")
    page.wait_for_selector(".rule .sum")
    sum1 = page.locator(".rule .sum").first.inner_text()
    check("правило 1: сводка содержит any/none/DH/equip/states",
          all(x in sum1 for x in ("any: bonded", "none: hazmat", "DH ≤ 150", "equip: V", "to: TX")), sum1)

    # ---- правило 2: только порог $/mi ----
    page.click("#rule-add")
    page.fill("#rf-name", "Premium $8+/mi")
    page.fill("#rf-rpm", "8")
    page.click("#rf-save")
    page.wait_for_function("document.querySelectorAll('.rule .sum').length === 2")
    sum2 = page.locator(".rule .sum").nth(1).inner_text()
    check("правило 2: сводка «≥ $8/mi»", "≥ $8/mi" in sum2, sum2)
    page.screenshot(path=str(OUT / "03-two-rules.png"), full_page=True)

    # ---- storage + persist ----
    st = stored_rules(page)
    r1, r2 = st["rules"]
    check("storage: 10 ключевых слов any, первое bonded", len(r1["keywordsAny"]) == 10 and r1["keywordsAny"][0] == "bonded", str(r1["keywordsAny"]))
    check("storage: keywordsNone = hazmat, team", r1["keywordsNone"] == ["hazmat", "team"], str(r1["keywordsNone"]))
    check("storage: maxDeadhead=150, equipment=[V], states upper-case",
          r1["maxDeadhead"] == 150 and r1["equipment"] == ["V"] and r1["destStates"] == ["TX", "OK", "ON"],
          f"{r1['maxDeadhead']} {r1['equipment']} {r1['destStates']}")
    check("storage: правило 2 minRpm=8, enabled", r2["minRpm"] == 8 and r2["enabled"] is True)
    page.reload()
    page.wait_for_load_state("networkidle")
    page.wait_for_selector(".rule .sum")
    check("после перезагрузки попапа оба правила на месте", page.locator(".rule").count() == 2, str(page.locator(".rule").count()))

    # ---- edit подхватывает сохранённое, не дублирует ----
    page.locator(".rule-edit").first.click()
    page.wait_for_selector("#rf-name")
    check("edit: имя подставлено", page.input_value("#rf-name") == "Bonded / TSA / Canada", page.input_value("#rf-name"))
    check("edit: keywords any подставлены", page.input_value("#rf-any").startswith("bonded, in-bond"), page.input_value("#rf-any"))
    check("edit: chip V подсвечен", page.locator("#rf-equip .chip.on").count() == 1
          and page.locator("#rf-equip .chip.on").get_attribute("data-code") == "V")
    check("edit: states подставлены", page.input_value("#rf-states") == "TX, OK, ON", page.input_value("#rf-states"))
    page.fill("#rf-rate", "1500")
    page.click("#rf-save")
    page.wait_for_selector(".rule .sum")
    sum1b = page.locator(".rule .sum").first.inner_text()
    check("edit: min rate добавлен, остальное не потеряно", "≥ $1500" in sum1b and "any: bonded" in sum1b, sum1b)
    check("edit: правило не задублировалось", page.locator(".rule").count() == 2)

    # ---- cancel ----
    page.locator(".rule-edit").first.click()
    page.wait_for_selector("#rf-name")
    page.fill("#rf-name", "SHOULD NOT SAVE")
    page.click("#rf-cancel")
    page.wait_for_selector(".rule .rhd b")
    check("cancel: имя не изменилось", page.locator(".rule .rhd b").first.inner_text() == "Bonded / TSA / Canada")

    # ---- тумблер enabled ----
    page.locator(".rule-on").nth(1).uncheck()
    page.wait_for_function("chrome.storage.local.get('ll_alert_rules').then(r => r.ll_alert_rules.rules[1].enabled === false)")
    check("тумблер: правило 2 выключено в storage", stored_rules(page)["rules"][1]["enabled"] is False)
    page.screenshot(path=str(OUT / "04-edited-toggled.png"), full_page=True)

    # ---- delete (confirm → accept) ----
    page.once("dialog", lambda d: d.accept())
    page.locator(".rule-del").nth(1).click()
    page.wait_for_function("document.querySelectorAll('.rule').length === 1")
    st = stored_rules(page)
    check("delete: осталось одно правило в UI и storage", len(st["rules"]) == 1 and st["rules"][0]["name"] == "Bonded / TSA / Canada")

    # ---- Free: редактора нет, есть плашка Pro ----
    set_auth(page, "free", "free@loadlens.test")
    page.reload()
    page.wait_for_load_state("networkidle")
    page.wait_for_selector("text=are a Pro feature", timeout=10000)
    body = page.inner_text("body")
    check("free: секция правил скрыта, показана плашка Pro", "Alert rules" not in body and "are a Pro feature" in body)
    page.screenshot(path=str(OUT / "05-free.png"), full_page=True)

    check("нет JS-ошибок страницы", not errors, "; ".join(errors))
    bad = [c for c in console if c.startswith("[error]")]
    check("нет console.error", not bad, "; ".join(bad)[:500])
    ctx.close()

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed · скриншоты: {OUT}")
sys.exit(1 if fails else 0)
