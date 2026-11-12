/* Страница проверки брокера: MC → GET /api/v1/brokers/:mc/shield (Fraud Shield, открыт всем) →
   вердикт и флаги через LLSCORE.shieldBadge/redFlags (js/scoring.js — та же логика, что у бейджа 🛡
   расширения). Строки интерфейса — JSON #ll-strings, его вписывает build-landing для каждого языка.
   MC кладём в ?mc=, чтобы результатом можно было поделиться ссылкой. */
(function () {
  "use strict";
  const S = JSON.parse(document.getElementById("ll-strings").textContent);
  const $ = (id) => document.getElementById(id);
  const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (_, k) => (k in v ? v[k] : ""));
  const lang = document.documentElement.lang;
  // Флаги лицензии, которые показываем на странице (repost — про конкретный lane, здесь его нет).
  const FLAG_KEYS = {
    authority_inactive: () => S["js.flag.inactive"],
    carrier_brokering: () => S["js.flag.carrier"],
    authority_not_found: (f) => S[f.sev === "high" ? "js.flag.notfound" : "js.flag.mismatch"],
    new_authority: (f, a) => fill(S["js.flag.new"], { d: age(a.ageDays) }),
    authority_incidents: (f, a) => fill(S["js.flag.incidents"], { n: a.incidents12m }),
  };

  // «MC-123456», «MC 123 456», «#123456» → «123456»; не 1–8 цифр → null (бэкенд вернул бы 400).
  function normalize(raw) {
    const d = String(raw || "").replace(/\D+/g, "").replace(/^0+(?=\d)/, "");
    return /^\d{1,8}$/.test(d) ? d : null;
  }

  // Intl склоняет единицы сам: «1 year / 5 years», «1 год / 5 лет», «1 an / 5 ani».
  const unit = (n, u) => new Intl.NumberFormat(lang, { style: "unit", unit: u, unitDisplay: "long" }).format(n);
  function age(days) {
    if (days == null) return null;
    if (days >= 365) return unit(Math.floor(days / 365), "year");
    if (days >= 60) return unit(Math.floor(days / 30), "month");
    return unit(days, "day");
  }

  // «2019-03-14» — дата без времени, считаем в UTC, иначе к западу от Гринвича съедет на день.
  const date = (ymd) => new Date(ymd + "T00:00:00Z").toLocaleDateString(lang, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

  function show(state) {
    $("empty").hidden = state !== "empty";
    $("result").hidden = state === "empty";
  }

  function message(text) {
    show("result");
    $("msg").hidden = false;
    $("msg").textContent = text;
    $("res-body").hidden = true;
  }

  function saferLink(mc) {
    $("safer").href = "https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=MC_MX&query_string=" + mc;
  }

  function render(mc, shield) {
    const a = shield.authority;
    const badge = LLSCORE.shieldBadge(shield);
    show("result");
    $("msg").hidden = true;
    $("res-body").hidden = false;
    const v = $("verdict");
    v.className = "verdict " + badge.level;
    v.textContent = fill(S["js.verdict." + badge.level], { mc });
    const flags = a ? LLSCORE.redFlags({ brokerMc: mc }, { shield }).filter((f) => FLAG_KEYS[f.code]) : [];
    const list = $("flags");
    list.textContent = "";
    for (const f of flags) {
      const li = document.createElement("li");
      li.className = f.sev;
      li.textContent = FLAG_KEYS[f.code](f, a);
      list.append(li);
    }
    list.hidden = !flags.length;
    const unknown = S["js.unknown"];
    $("f-status").textContent = a && a.status ? S["js.status." + a.status] : unknown;
    $("f-since").textContent = a && a.grantedAt ? fill(S["js.since"], { date: date(a.grantedAt), age: age(a.ageDays) }) : unknown;
    $("f-incidents").textContent = a && a.incidents12m != null ? String(a.incidents12m) : unknown;
    $("checked").textContent = a && a.checkedAt
      ? fill(S["js.checked"], { mc, when: new Date(a.checkedAt).toLocaleString(lang, { dateStyle: "medium", timeStyle: "short" }) })
      : "";
  }

  let seq = 0;
  async function check(raw) {
    const mc = normalize(raw);
    if (!mc) { $("safer").href = "https://safer.fmcsa.dot.gov/"; message(S["js.err.invalid"]); return; }
    $("mc").value = mc;
    saferLink(mc);
    const url = new URL(location.href);
    url.searchParams.set("mc", mc);
    history.replaceState(null, "", url);
    const my = ++seq;
    message(fill(S["js.loading"], { mc }));
    $("go").disabled = true;
    try {
      const res = await fetch("/api/v1/brokers/" + encodeURIComponent(mc) + "/shield", { headers: { Accept: "application/json" } });
      if (my !== seq) return;
      if (res.status === 429) return message(S["js.err.rate"]);
      if (res.status === 400) return message(S["js.err.invalid"]);
      if (!res.ok) return message(S["js.err.net"]);
      render(mc, await res.json());
    } catch (e) {
      if (my === seq) message(S["js.err.net"]);
    } finally {
      if (my === seq) $("go").disabled = false;
    }
  }

  $("check").addEventListener("submit", (e) => { e.preventDefault(); check($("mc").value); });
  const initial = new URLSearchParams(location.search).get("mc");
  if (initial) { $("mc").value = initial; check(initial); }
})();
