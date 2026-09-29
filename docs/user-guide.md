# LoadLens User Guide

LoadLens is a Chrome extension that runs on top of the DAT One load board you are already signed in to. It reads the loads on your screen, scores them, checks Hours of Service, vets the broker, and can send the loads you care about to Telegram. It never logs in for you and never pulls data on its own.

Version covered: 0.9.x. Needs Chrome 116 or newer (LoadLens lives in Chrome's side panel). Free features work without an account. Pro features need a LoadLens account on the Pro plan.

---

## 1. Setup

1. Install LoadLens from the Chrome Web Store.
2. Click the LoadLens icon at the top of Chrome. The LoadLens side panel opens on the right of the window. It has two tabs: **Loads** (the results of the DAT tab you are on) and **Settings** (everything else).
3. On the Settings tab, click Sign up, enter an email and a password (8 characters minimum). Free users can skip this, but alerts, fleet, CSV export and cloud need an account.
4. Open DAT One, run a search. Badges appear under each row, and the Loads tab fills with the scored results.

The side panel stays open while you move between tabs. On any DAT tab you can also open it with the blue "🚚 LoadLens" button in the corner of the page, or by clicking a load's badge. If Chrome refuses to open it from the page, click the LoadLens icon instead.

A Pro account works on up to 3 devices. Signing in on a fourth signs out the one you used least recently.

---

## 2. What you see on every load (Free)

Under each row of the DAT results table LoadLens draws a strip of chips.

**Profit chip.** True rate per mile after deadhead, fuel at the current national diesel price, and your cost per mile.
- Green: the rate meets your target for that trip distance (see Target rates below).
- Amber: above break-even but below target.
- Red: below your cost per mile. You lose money on it.
The number shown is $/mi to your truck, not the posted rate divided by trip miles.

**HOS chip.** Can the driver legally run this load with the hours left today? Uses the 11-hour driving, 14-hour on-duty, 30-minute break and 70-hour/8-day rules. Green means yes, amber means it is tight or needs a rest stop on the way, red means no. Hours come from Driver settings on the Settings tab (or from the active driver in Fleet).

**Broker chip.** From DAT's own data: credit score and days to pay.
- good: credit 90 or more
- ok: in between
- risk: credit under 75 or more than 40 days to pay

**Community chip.** Reputation built from reports by other LoadLens users: Paid, Slow pay, Flaked / canceled, Double-broker. Shows good, mixed, bad or thin (not enough reports yet). Click it to leave your own report on that broker. One report per user per broker, so it cannot be gamed.

**Driver chip (Pro, with Fleet).** "best driver (N/M)": which of your drivers this load fits best and how many of them can run it legally and profitably. Click for the driver-by-driver breakdown.

**ⓘ details.** Opens the load card in the side panel.

**Posting age.** How long ago the broker posted or refreshed the load, shown as 🕒 on the load card: green up to 30 minutes, amber from 6 hours. Old postings are often already covered.

Badges are drawn only for rows currently on screen. The Loads tab always has the full list.

---

## 3. Load card

Click ⓘ details (or the driver chip) under a row, or a load under Hot loads on the Loads tab. The card opens on the Loads tab of the side panel; ← Back returns to the list.

- Posted rate, rate to your truck, market median for the lane ("market $X"), real road miles for the loaded leg and the deadhead.
- Pickup date, equipment, trailer length, weight and the broker's comments.
- Broker name, MC number, credit score, days to pay, contact phone and email, plus payment-assurance and TIA signals when DAT shows them.
- Book Now link when the posting has one.

**Contact the broker in one click.**
- Email broker: opens a Gmail draft prefilled with the lane, miles, pickup date and a suggested counter-offer. You read it and press Send yourself. Nothing is sent automatically.
- Call: dials the posted phone.
- Copy email: copies the broker's email to the clipboard.
The lead button follows the contact method the broker asked for in the posting.

**Counter-offer.** LoadLens suggests a number at least 10% above the posting, not below the lane market rate and not below your break-even, capped at market plus 15%, rounded to $25. Edit the template on the Settings tab (Broker email template) if you want different wording. Leave the counter-offer placeholder in and it disappears from the draft when there is no data for it.

---

## 4. The Loads tab

The Loads tab shows the DAT tab you are on. Switch to another DAT tab and it follows; on any other site it asks you to open a load board tab. If it says "Reload the load board tab", that tab was opened before LoadLens was installed or updated: reload it once.

At the top:

- **Driver switcher** (Pro, with Fleet): pick which driver's hours, trailer and location the scoring and chains use.
- **Loads in results**, the **equipment filter** in effect (set it on the Settings tab), **start market** and the national **diesel** price.
- **Cost/mi** and **Start**: quick edits of your cost per mile and where the truck is now (as CITY_ST, for example CHICAGO_IL). Start defaults to the top origin market in the current results. When the active Fleet driver has their own cost or market, theirs wins and the field goes back to it.
- **Auto-refresh** checkbox (DAT only): turns the auto-pilot on or off for this DAT tab only (see section 6).
- **● live**: DAT is streaming new matches for this search, and they land in the list without a refresh (see "DAT live matches" in section 6).
- **Sort** and direction (DAT only): the DAT sort to hold after each refresh.

Below that:

- **Get-out chains** (full planner with Pro).
- **Hot loads**: the loads that are green and match your equipment filter, freshest first. Click one to open its card.
- **⬇ CSV** (Pro): export the loaded results to a spreadsheet.
- **🙈 Hide on page**: hides LoadLens badges and the button on this DAT tab until you show them again from the same place.

**Get-out chains (full planner with Pro).** When you are in a weak market with nothing good outbound, the panel builds chains of 2 or 3 loads ahead and ranks them by net $/mi across the whole chain and by the strength of the destination market. A chain can start with a so-so load if it puts the truck in a strong market. Click a chain to see its legs. Each leg shows $/mi and an HOS badge, with required rest inserted where the hours run out. Click a leg marked LIVE IN RESULTS to scroll to that load in the DAT table. Legs marked MARKET FORECAST come from loads other LoadLens users have seen in that market, so the chain can go beyond what is in your current search.

---

## 5. The Settings tab

Click the LoadLens icon, then the Settings tab. Your account, Fleet, Telegram and Cloud browser are at the top; the settings below sit under ⚙ Settings. Press Save at the bottom, except where noted. Save only writes what you changed on this tab, so it never undoes a sort or an auto-refresh switch you changed on the Loads tab.

**Driver settings**
- Cost / mile, $: your all-in operating cost. Default 1.80. This is the red line.
- Drive left, Duty left, Cycle left, hours: what the driver has left right now. Feeds the HOS chip. If you use Fleet, the active driver's hours override these.

**Target rates by distance.** The green line. Default: $7/mi for trips up to 500 miles, $6 up to 1,000, $5 above. Change them to what you consider a good rate.

**Equipment filter.** Toggle chips for trailer types (Van, Reefer, Flatbed and the other DAT groups). All or Clear buttons. Loads outside the selection are hidden on the Loads tab and skipped by alerts.

**DAT tab auto-pilot** and **DAT live matches.** See section 6.

**On-page display.** These apply instantly to every open DAT tab, no Save needed.
- Hide badges in table: no chips under the rows.
- Hide the LoadLens button: no button in the corner of the DAT page. Open LoadLens from its icon in the Chrome toolbar.

**Broker email template.** The text used by Email broker. Placeholders in double braces (lane, miles, pickup date, counter-offer and so on). Reset to default brings the original back.

---

## 6. Auto-pilot: keep the search fresh (Free, off by default)

DAT does not reload results on its own. The auto-pilot does it for you on the DAT tab you leave open. It works on DAT One only.

**Stay inside DAT's search limit.** DAT's terms treat more than 500 searches per user per month as a breach of your subscription, and DAT watches for it. Every refresh is a new search. LoadLens counts all searches on this device, including the ones you run yourself, and the auto-pilot stops once the monthly budget is spent.

1. Settings tab, DAT tab auto-pilot: switch on "Enable on DAT tabs".
2. Interval, sec: how often to refresh. 3 minutes by default, 2 minutes at the least. LoadLens adds a random delay on top, so the pattern is not even.
3. Auto-scroll (pull all pages): on by default. After a new search the tab scrolls down so DAT loads every page of results, not just the first screen; later refreshes only pull a couple of pages. The Loads tab holds the complete list.
4. Quiet hours: on by default, 22:00 to 5:00. The auto-pilot pauses overnight, when brokers barely post. Hours follow this computer's clock, shown next to the setting (in the cloud browser that is the server's time).
5. Monthly search limit: 450 by default, leaving a margin below DAT's 500 for searches on your other devices. "DAT searches this month" shows how many you have used. The budget is spread evenly over the month, so the auto-pilot does not use it all in the first days. Ignore the limit only at your own risk. Your own searches are never blocked.
6. Sort and Direction: the DAT sort to re-apply after each refresh, or "keep current".
7. Save. Leave the results tab open. It can be in the background.

Per-tab override: the Auto-refresh checkbox on the Loads tab turns it on or off for the DAT tab you are on. Changing "Enable on DAT tabs" resets every tab to that setting.

How it refreshes: if DAT's SEARCH button is active, LoadLens clicks it. If DAT has greyed it out (nothing changed in the criteria), LoadLens reloads the page, which reruns the same search from the URL, then re-applies your sort. It reloads at most once every 15 minutes, and only when no new results have arrived for 10 minutes; otherwise it skips that turn.

**DAT live matches** (off by default). DAT already streams new matching loads to every open search tab. With "Listen to DAT live matches" on, LoadLens reads that stream: new loads appear on the Loads tab and go through your Telegram alert rules the moment they are posted, with no refresh and no extra requests to DAT. While the stream is running (● live on the Loads tab), the auto-pilot checks far less often. It needs a DAT One plan with live matches (Pro and up); on lower plans nothing arrives and the auto-pilot remains the way to get alerts.

---

## 7. Telegram alerts (Pro)

Get a Telegram message the moment a load you want appears, while the DAT tab is open with the auto-pilot or DAT live matches running.

**Connect** (any plan: the password reset code also comes through the bot)
1. Settings tab, Telegram, Connect Telegram. A Telegram link opens to the LoadLens bot.
2. Press Start in the bot. Within a few seconds the Settings tab shows "linked ✓".
3. Pro: switch on Send alerts.

**Without rules** every load that is green and matches your equipment filter is sent.

**With rules** only loads matching at least one rule are sent. Click Add rule. Fields, all optional:
- Name: printed as the first line of the alert, so you know which rule fired.
- Comments contain any of: comma-separated keywords. Matches the broker's posting comments. "in-bond" and "inbond" are treated as the same word.
- Comments must NOT contain: keywords that disqualify the load, for example hazmat, team.
- Min rate, $: total posted rate.
- Min $/mi (incl. deadhead): rate divided by loaded plus empty miles to pickup. This is the real number to your truck, not the posted per-mile.
- Max deadhead, mi.
- Min credit score: broker's DAT credit.
- Min and Max loaded miles.
- Max posting age, min: only loads posted or refreshed within this many minutes. Loads without a posting time are skipped by such a rule.
- Equipment: leave empty to use your global filter.
- Destination states: two-letter codes, comma-separated, for example TX, OK, ON.
- Brokers allow (MC) and Brokers block (MC): MC numbers, comma-separated.
- Score: Any, Green only, or Green or amber.

Inside one rule every filled field must match (AND). Between rules, any match sends the load (OR). Toggle a rule off without deleting it with the switch next to its name. Loads posted without a rate pass keyword rules and are shown as "rate: ask".

**What the message contains.** Rule name, lane, rate, miles, $/mi, how long ago it was posted, broker name, MC and credit score, pickup date, broker phone and email, and the posting's comments (often where the email and the trailer details are).

**Limits.** The same load is not sent twice within 6 hours. At most 10 messages per 10 minutes, so a busy board does not flood you.

**Where the rules live.** Rules are stored in the browser that watches DAT. If you use the cloud browser, enter the rules in the LoadLens side panel inside the cloud window, not on your laptop.

---

## 8. Fleet (Pro)

For dispatchers with more than one truck. Settings tab, Fleet, + Add driver. For each driver:
- Name
- Current market, as CITY_ST, for example CHICAGO_IL. Used for deadhead.
- Equipment
- $/mi: that driver's cost per mile, or blank for the default.
- Drive, Duty, Cyc: hours left today and in the cycle.
- Status: set to off to exclude a driver from matching (on vacation, in the shop).

Pick the active driver at the top of the Loads tab; new drivers show up there right away. The scoring, HOS chip and Get-out chains follow that driver. Every load also shows the driver chip described in section 2: which driver fits best and how many can take it. Matching runs locally in your browser.

---

## 9. Cloud browser (Pro Cloud)

Instead of leaving your own computer on, LoadLens runs a Chrome browser with the extension on our server. The auto-pilot runs around the clock and alerts keep coming while your laptop is closed.

1. Settings tab, Cloud browser, tick the consent line, Enable Cloud. Startup takes 1 to 2 minutes. The security certificate for the screen link takes about as long, so a certificate warning right after Enable is expected and clears on reload.
2. Open screen (or copy the link). The page asks for the password shown on the Settings tab, then shows a desktop with Chrome and DAT. Works from a laptop or a phone.
3. Sign in to DAT in that window. Your DAT password goes straight to DAT. LoadLens never sees or stores it.
4. Set your search, leave the results page open.
5. In that same window, click the LoadLens icon to open the side panel, sign in, connect Telegram and enter your rules.

Close the screen whenever you like. The browser keeps running. Open the link again to change the search.

Things to know:
- DAT allows one desktop web session per login. The cloud browser is a desktop session. Opening DAT on your own computer at the same time may sign one of them out. The DAT phone app is a separate session.
- If the cloud browser gets signed out of DAT or stops seeing new loads for 15 minutes, you get a Telegram message with the screen link so you can sign back in.
- Disable Cloud stops the browser. Enable Cloud starts a fresh one.

---

## 10. Broker reports

Click the community chip on any load to report your experience with that broker: Paid, Slow pay, Flaked / canceled, Double-broker. Reports are tied to the MC number. Each user has one vote per broker and can change it later. Pro users see the aggregate (good, mixed, bad, thin) next to DAT's own credit score; anyone can report.

---

## 11. Account

Settings tab, at the top.
- Sign up, Sign in, Sign out.
- Change password: needs the current one; the new one must be 8 characters or more and different. Changing it signs you out on every other device.
- Forgot password: sends a one-time code to your linked Telegram. Works only if Telegram is connected.
- Delete account: removes the account and all its data, including drivers. Cannot be undone.

---

## 12. Free vs Pro

Every account gets 14 days of Pro once, starting when you sign up (existing free accounts: the next time you open Settings). The Settings tab shows "PRO TRIAL" and the days left; the Telegram bot reminds you two days before it ends. To keep Pro, email hello@krait.studio.

| Feature | Free | Pro |
|---|---|---|
| Profit, HOS and broker chips on every load | yes | yes |
| Load card with contacts, Email broker, counter-offer | yes | yes |
| Loads tab, Hot loads, equipment filter, sort | yes | yes |
| Auto-pilot refresh, auto-scroll, DAT live matches | yes | yes |
| Broker reports | yes | yes |
| Telegram link for password reset | yes | yes |
| CSV export | | yes |
| Market median per lane, market strength, road miles from the crowd database | | yes |
| Get-out chains | | yes |
| Telegram alerts and alert rules | | yes |
| Fleet and driver matching | | yes |
| Up to 3 devices | | yes |
| Cloud browser | | Pro Cloud |

Free users see "market" values only when a lane has data cached locally. Everything else in Free is computed in your browser from what DAT shows.

---

## 13. Privacy in one paragraph

LoadLens reads only the loads your own signed-in DAT session already loaded. It does not send requests to DAT, does not log in for you and does not store your DAT password. Load data you see is synced to the LoadLens database to build lane medians and broker reputation. Other users never receive broker contact details from your data, only aggregates. Full policy: https://loadlens.krait.studio/privacy.html

---

## 14. If something looks wrong

- No badges on the page: reload the DAT tab. Check that the Loads tab does not show "👁 Show on page" (click it if it does), and that Hide badges is off on the Settings tab.
- No LoadLens button on the page: it hides while the side panel is open on that tab, and when "Hide the LoadLens button" is on. The toolbar icon always works.
- Loads tab stuck on "Connecting" or asking to reload: reload the DAT tab. If another extension's side panel is open in that window, close it; Chrome shows one side panel at a time.
- Loads tab shows loads but no market numbers: you are on Free, or not signed in. Market data needs Pro.
- Alerts stopped: is the DAT tab still open and signed in? Is the auto-pilot enabled, on the Settings tab or with the Loads tab checkbox? Is the monthly search budget spent, or is it quiet hours? Is Send alerts on? Do the rules match anything (try switching them all off to get the default green loads)?
- Auto-pilot does nothing: check "DAT searches this month" against your limit, and the quiet hours. DAT keeps SEARCH disabled until criteria change, so LoadLens reloads the page instead, at most every 15 minutes. Make sure the tab is not discarded by Chrome's memory saver.
- Cloud screen shows a certificate warning: wait 2 minutes and reload.
- Anything else: message us on Telegram.
