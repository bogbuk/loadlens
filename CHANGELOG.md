# Changelog

All notable user-facing changes to the LoadLens browser extension.

## [Unreleased]

### New
- **Cloud browser (Pro Cloud): always-on DAT session.** Run your search on a browser we host, with the extension pre-loaded, instead of leaving your own laptop on. The auto-pilot keeps working around the clock.
- **Cloud browser: live screen link.** Open a link to see and control the cloud browser's screen from any device, so you can log in or check on it whenever you need to.
- **Cloud browser: sign-out and stale-session alerts.** Get a Telegram message if the cloud session signs out or stops refreshing, so a lapsed login doesn't go unnoticed. Opt-in, with a clear heads-up that DAT will see the login coming from a cloud server.

## 0.6.0 — 2026-09-12

### New
- **Custom Telegram alert rules.** In the popup, build rules that pick exactly which loads reach your Telegram: keywords that must or must not appear in the broker's comments (bonded, in-bond, TWIC, hazmat…), minimum rate per mile, maximum deadhead, destination states, equipment and broker. Rules combine with OR, conditions inside a rule with AND. With no rules, alerts keep working as before: every profitable load matching your equipment filter. Pro feature.
- **One-click broker email with a counter-offer.** Every load card now has ✉️ Email broker / 📞 Call / 📋 Copy email; the lead button follows the broker's preferred contact method. The email opens as a Gmail draft prefilled with the lane, miles, pickup date and a suggested counter-offer based on the market rate — you review and send it yourself. The template is editable in the popup.

### Changed
- **Auto-pilot has a real on/off switch in the popup.** "Enable on DAT tabs" turns it on for every DAT results tab; the Auto-refresh checkbox in the on-page panel still overrides it for that tab only. Previously the popup only stored the interval and the auto-pilot had to be enabled tab by tab.
- **Alerts skip loads with no posted rate.** Postings without a published rate no longer trigger Telegram messages.

## 0.5.0 — 2026-07-20

### Changed
- **A Pro subscription now covers up to 3 devices.** Signing in on a fourth device signs out the one you haven't used in the longest time. If that happens, the sign-in screen tells you why.

## 0.4.0 — 2026-07-20

### Changed
- **The extension is now fully in English.** The popup, the on-page panel, load badges and chips, Get-out chains, the broker review menu, the load detail card, error messages and the Telegram bot's replies all read in English. Pickup dates now use US formatting.

## 0.3.6 — 2026-07-17

### New
- **Telegram alerts now show the broker's name and the load's comments.** The alert message includes the broker company name next to the MC number, plus a 💬 line with the posting's comments — often the fastest way to spot the contact email and key details like exact trailer length.

### Changed
- **Richer market data sync.** The extension now syncs the full set of load details it already reads from the board (pickup dates, credit info, equipment specifics, booking signals), improving lane statistics and future scoring.

## 0.3.5 — 2026-06-30

### New
- **Auto-pilot now loads the whole board, not just the first screen.** When enabled, the dedicated tab scrolls the results to the bottom so the load board lazy-loads every page, and the panel keeps the complete set of loads for the current search instead of only what fit on screen. Stays opt-in; you can turn the scrolling off separately in the popup.
- **Hide the panel and the in-table badges independently.** The display section now has two separate toggles, so you can keep the on-row badges while hiding the side panel, or vice-versa.
- **Trailer-type filter is now multi-select.** Pick several equipment types at once with toggle chips instead of a single choice.

### Changed
- **Richer load details from the board.** Each load now surfaces more of the board's own data (payment-assurance and TIA-membership signals, broker location, pickup window, structured broker contact), improving scoring and the detail card.

## 0.3.4 — 2026-06-28

### Changed
- **Changing your password now signs you out everywhere.** After a successful password change you're returned to the sign-in screen and must log in again with the new password — old sessions on other devices stop working immediately.

## 0.3.3 — 2026-06-27

### New
- **Reset a forgotten password from the popup.** A "Забыл пароль?" link on the sign-in screen sends a one-time code to your linked Telegram bot; enter the code and a new password to regain access. Works for accounts that have linked Telegram.

## 0.3.2 — 2026-06-27

### New
- **Change your password from the popup.** The account section now has a "Сменить пароль" button that opens an inline form (current password + new password). Requires your current password; the new one must be at least 8 characters and different from the old.

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
