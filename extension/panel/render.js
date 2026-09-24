/* LoadLens — рендер вкладки Loads боковой панели. Чистые функции «снапшот (LLVIEW) → HTML-строка».
   Всё, что пришло из DAT, экранируется здесь; клики размечены data-cmd — их делегирует sidepanel.js. */
const LLPANEL = (() => {
  "use strict";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const BOARD_RE = /^https:\/\/([a-z0-9-]+\.)*(dat|truckstop)\.com\//i;
  const isBoardUrl = (url) => typeof url === "string" && BOARD_RE.test(url);
  const row = (k, vHtml) => `<div class="row"><span class="k">${esc(k)}</span><span class="v">${vHtml}</span></div>`;
  const REPORT_OPTS = [
    { o: "paid", t: "✅ Paid" },
    { o: "no_issue", t: "👍 No issues" },
    { o: "slow", t: "🐢 Slow pay" },
    { o: "flaked", t: "🚫 Flaked / canceled" },
    { o: "double_brokered", t: "⛔ Double-broker" },
  ];

  function header(h) {
    const ar = h.autoRefresh;
    return (h.drivers.length ? `<div class="ll-driver"><span class="k">Driver</span><select id="ll-driver">` +
        h.drivers.map((d) => `<option value="${esc(d.id)}"${d.id === h.activeDriverId ? " selected" : ""}>${esc(d.label)}</option>`).join("") +
        `</select></div>` : "") +
      row("Loads in results", esc(h.loadsCount)) +
      (h.equipFilter ? row("Equipment filter", esc(h.equipFilter)) : "") +
      row("Start market", h.start ? esc(h.start) : "—") +
      row("Diesel", "$" + esc(h.diesel) + "/gal") +
      `<div class="ll-cfg">Cost/mi: <input id="ll-cpm" type="number" step="0.05" value="${esc(h.cpm)}"> ` +
      `Start: <input id="ll-start" type="text" value="${esc(h.start || "")}" placeholder="CHICAGO_IL"></div>` +
      `<div class="ll-cfg" title="Auto-pilot: the DAT tab clicks Search itself and holds the sort order. This checkbox overrides the global switch (Settings) for this tab only">` +
        `<label${ar.cloud ? ' title="Cloud mode: auto-pilot is always on in the cloud browser"' : ""}><input type="checkbox" id="ll-ar"${ar.on ? " checked" : ""}${ar.cloud ? " disabled" : ""}> Auto-refresh${ar.cloud ? " (Cloud)" : ""}</label> ` +
        (h.sseLive ? `<span class="ll-live" title="Listening to DAT's live match stream for this search — new loads arrive without a refresh">● live</span> ` : "") +
        `Sort: <select id="ll-sort-f"><option value="">—</option>` +
        h.sortFields.map((s) => `<option value="${esc(s.field)}"${h.sort.field === s.field ? " selected" : ""}>${esc(s.label)}</option>`).join("") +
        `</select> <button data-cmd="setSortDir" data-dir="${h.sort.dir === "asc" ? "desc" : "asc"}" title="Sort direction">${h.sort.dir === "asc" ? "▲ Low" : "▼ High"}</button></div>`;
  }

  function chips(list) { return list.map((c) => `<span class="lchip${c.cls ? " " + esc(c.cls) : ""}">${esc(c.text)}</span>`).join(""); }
  function legHtml(l) {
    const nb = l.nbMi > 0 ? `<span class="leg-nb">↪ +${esc(l.nbMi)}mi nearby</span>` : "";
    if (l.kind === "live") {
      return `<div class="leg leg-live" data-cmd="scrollToRow"${l.resultId != null ? ` data-result="${esc(l.resultId)}"` : ""}>` +
        `<div class="leg-top"><span class="leg-tag live">● LIVE IN RESULTS ↗</span><span class="leg-idx">${esc(l.idx)}</span></div>` +
        `<div class="leg-route">${esc(l.route)}${nb}</div><div class="leg-eco">${esc(l.eco)}</div>` +
        `<div class="leg-chips">${chips(l.chips)}</div></div>`;
    }
    return `<div class="leg leg-fc"><div class="leg-top"><span class="leg-tag fc">◔ MARKET FORECAST</span><span class="leg-idx">${esc(l.fresh)}</span></div>` +
      `<div class="leg-route">${esc(l.route)}${nb}</div><div class="leg-eco">${esc(l.eco)}</div></div>`;
  }
  function chainHtml(c, expandedSig) {
    const open = c.sig === expandedSig;
    return `<div class="chain ll-${esc(c.hos)}${open ? " open" : ""}">` +
      `<div class="chain-hd" data-cmd="toggleChain" data-sig="${esc(c.sig)}">` +
      `<div class="route">${esc(c.path)} <span class="caret">${open ? "▾" : "▸"}</span></div><div class="meta">${esc(c.meta)}</div></div>` +
      (open ? `<div class="chain-legs">${c.legs.map(legHtml).join("")}</div>` : "") + `</div>`;
  }
  function dealHtml(d) {
    return `<div class="deal" data-cmd="openDetail" data-load="${esc(d.loadId)}"><span class="m">${esc(d.lane)}` +
      (d.age != null ? ` <span class="age">🕒 ${esc(d.age)}</span>` : "") + `</span><span class="p">$${esc(d.rpm)}/mi</span></div>`;
  }

  function detailHtml(d) {
    const a = d.actions;
    const link = (href, label, primary) => `<a class="btn${primary ? " primary" : ""}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    return `<div class="detail"><div class="dhd"><button type="button" class="back" data-cmd="closeDetail">← Back</button><span class="ttl">${esc(d.title)}</span></div>` +
      d.rows.map((r) => `<div class="drow"><span class="k">${esc(r.k)}</span><span class="v">${r.href ? `<a href="${esc(r.href)}">${esc(r.v)}</a>` : esc(r.v)}</span></div>`).join("") +
      (d.flags.length ? `<div class="flags">${d.flags.map((f) => "• " + esc(f)).join("\n")}</div>` : "") +
      (d.comments ? `<div class="drow"><span class="k">Notes</span><span class="v comments">${esc(d.comments)}</span></div>` : "") +
      (d.fleet ? `<div class="fleet-match"><div class="fleet-h">${esc(d.fleet.title)}</div>` +
        d.fleet.rows.map((r) => `<div class="fleet-row ll-${r.ok ? "ok" : "no"}">${esc(r.text)}</div>`).join("") + `</div>` : "") +
      `<div class="actions">` +
        (a.book ? link(a.book.url, esc(a.book.label), true) : "") +
        (a.mail ? link(a.mail.url, "✉️ Email broker", a.mail.primary) : "") +
        (a.call ? `<a class="btn${a.call.primary ? " primary" : ""}" href="${esc(a.call.href)}">📞 Call</a>` : "") +
        (a.copyEmail ? `<button type="button" class="btn" data-cmd="copy" data-what="email">📋 Copy email</button>` : "") +
        `<button type="button" class="btn" data-cmd="copy" data-what="load">Copy</button>` +
      `</div>` +
      (a.brokerMc ? `<details class="review"><summary>Broker review · MC ${esc(a.brokerMc)}</summary>` +
        REPORT_OPTS.map((r) => `<button type="button" class="ll-rep-opt" data-cmd="reportBroker" data-mc="${esc(a.brokerMc)}" data-outcome="${r.o}">${r.t}</button>`).join("") +
        `</details>` : "") +
      `</div>`;
  }

  function loadsView(snap, ui) {
    const notice = ui.notice ? `<div class="notice">${esc(ui.notice)}</div>` : "";
    if (snap.detail) return notice + detailHtml(snap.detail);
    return header(snap.header) +
      (snap.chains.length ? "<h4>Get-out chains</h4>" + snap.chains.map((c) => chainHtml(c, ui.expandedSig)).join("")
        : "<div class='note'>Chains appear once enough loads from the start market are visible.</div>") +
      (snap.deals.length ? "<h4>Hot loads</h4>" + snap.deals.map(dealHtml).join("") : "") +
      `<div class="ll-ft"><button type="button" data-cmd="exportCsv" title="Export visible loads to CSV">⬇ CSV</button><span class="pro-tag">Pro</span>` +
      `<button type="button" data-cmd="setHintsOff" data-on="${snap.hintsOff ? "0" : "1"}" title="LoadLens badges and button on this DAT tab">${snap.hintsOff ? "👁 Show on page" : "🙈 Hide on page"}</button></div>` +
      notice +
      "<div class='note'>Scoring accounts for deadhead, fuel and the lane market median. The board rate is the broker's asking price. The HOS badge shows whether the driver can legally run it.</div>";
  }

  const EMPTY = {
    "not-board": "Open a DAT One or Truckstop search tab — LoadLens shows its loads here.",
    "connecting": "Connecting to the DAT tab…",
    "no-script": "Reload the DAT tab to connect LoadLens (it was opened before the extension was installed or updated).",
  };
  const empty = (kind) => `<div class="empty-state">${esc(EMPTY[kind] || EMPTY["not-board"])}</div>`;

  return { isBoardUrl, loadsView, empty };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLPANEL; }
if (typeof globalThis !== "undefined") globalThis.LLPANEL = LLPANEL;
