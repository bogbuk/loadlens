# Changelog

All notable user-facing changes to the LoadLens browser extension.

## 0.3.1 — 2026-06-24

### Fixed
- **Auto-pilot now actually refreshes the board.** When the board's Search button is greyed out (because the search hasn't changed), the dedicated tab reloads the page to pull fresh loads, then re-applies your preferred sort. Previously it clicked the disabled button and nothing happened.

## 0.3.0 — 2026-06-22

### New
- **All DAT One trailer types.** Equipment filters now cover the load board's full set (Vans, Flatbeds, Reefers, Conestogas, Containers, Decks, Dry Bulk, Hazmat, Tankers and more) instead of just five — shown with readable names next to their codes.
- **Auto-pilot for the load-board tab (off by default).** Open the board in a separate tab and let it refresh on its own every 60–120 seconds while you work elsewhere, automatically re-applying your preferred sort after each refresh. It clicks the board's own Search button in your session — no new data calls — and stays opt-in.

### Notes
- No new permissions. Auto-pilot is disabled until you turn it on in the popup.

## 0.2.0 — 2026-06-17

### New
- **Get-out chain planner, redesigned as an expandable card.** Open a suggested multi-stop plan to see every leg — loads bookable right now versus forecast onward legs — each with trust and fit chips. Click a live leg to jump straight to that row on the board and highlight it.
- **Per-route summary.** Each chain option now shows an estimated number of days and dollars-per-day so options are easy to compare.
- **Nearby-market routing.** When the exact destination market is quiet, the planner continues the chain from a neighbouring market within a short detour — far fewer dead-end chains, with minimal extra empty miles.
- **Live market monitor.** Keep the panel open and suggestions refresh on their own; loads that have likely already been booked are dropped in near real time (pauses automatically when the panel is collapsed or the tab is hidden).
- **Freshness indicator on forecast legs** — fresh / cooling / likely gone — so you can judge at a glance how trustworthy a suggested load is.
- **"Detour" tag** marking legs that come from a neighbouring market, making it clear when a chain steps into an adjacent area to stay continuous.
- **Account deletion** available from the popup (Settings → delete account).

### Fixed
- Correctly match and scroll to the intended board row after DAT changed its row identifiers (previously both the row badges and scroll-to-load could miss).
- Freshness label now shown on forecast legs.
- Chain-display edge cases: suggestions could briefly vanish after switching the active driver, and a re-listed load could stay hidden after briefly disappearing.

### Notes
- No new permissions. The extension talks only to the LoadLens backend and the load boards you are already signed in to.

## 0.1.0

- Initial release: per-load profitability scoring ($/mile accounting for deadhead, fuel and lane market), HOS feasibility badge, driver fleet, broker reputation, and the first Get-out chain suggestions.
