# LoadLens — Chrome Web Store listing

Готовый текст для публикации (аудитория — диспетчеры/owner-operators на DAT One / Truckstop, США).
Privacy policy: https://loadlens.krait.studio/privacy.html

## Name (Title, ≤ ~45 симв.)

`LoadLens: Load Scoring for DAT & Truckstop`

Альтернативы:
- `LoadLens: Dispatcher Load Board Assistant` (без брендов в title, если модерация придерётся)

## Short description (≤ 132 симв.)

`Score every load by true $/mile after deadhead and fuel, check HOS, plan get-out chains, and vet brokers on DAT One & Truckstop.`

## Detailed description

```
LoadLens works on top of the DAT One and Truckstop load boards you already use.
It reads the loads on your screen and adds the numbers a dispatcher actually
needs to book well, without copying anything into a spreadsheet.

WHAT YOU SEE ON EVERY LOAD

• True rate-per-mile. Not the posted rate divided by trip miles, but profit per
  mile after empty miles to pickup, fuel at the current national diesel price,
  and tolls, compared to the recent market median for that lane.

• Hours-of-Service check. A green, amber, or red badge tells you whether the
  driver can legally run the load under the 11-hour, 14-hour, 30-minute, and
  70-hour/8-day rules before you make the call.

• Broker trust. DAT credit score and days-to-pay, plus a community reputation
  built from real "paid / slow / flaked / double-brokered" reports from other
  carriers, plus automatic red flags for rates that sit far above the market or
  postings with no MC number.

GET-OUT TRIP PLANNER

Soft market with nothing good outbound? LoadLens chains two or three loads ahead
and ranks routes by the strength of the destination market, so you can take a
fair load that repositions the truck instead of deadheading or sitting.

YOUR FLEET (PRO)

Add your drivers with their current market, trailer, and remaining hours. Every
load then shows which driver it fits best and how many of your drivers can run
it legally and profitably. One click breaks it down driver by driver.

PRIVACY AND HOW IT WORKS

LoadLens only reads the load data your own logged-in session already loaded. It
does not log into anything for you and does not pull data on its own. Broker
contact details (phones and emails) never leave your browser. Only de-identified
lane and rate aggregates are shared to power market medians. Full policy:
https://loadlens.krait.studio/privacy.html

REQUIREMENTS

You need an active DAT One or Truckstop account and to be logged in. LoadLens
adds insight on top of your subscription; it is not a load board by itself.

Free includes load scoring, HOS badges, and broker signals. Pro adds the full
get-out chain planner and driver fleet matching.
```

## Store fields

- Category: Workflow & Planning (или Productivity)
- Language: English
- Privacy policy URL: https://loadlens.krait.studio/privacy.html

## Permission justifications

- `storage` — saves your login session and caches settings and market data locally so the extension works fast and offline.
- Host `*.dat.com` / `*.truckstop.com` — reads the loads rendered on the board pages you open, to score them and draw badges.
- Host `loadlens.krait.studio` — the extension's own backend for accounts, lane-rate medians, and broker reputation.
- Remote code: No. All logic ships inside the package.

## Data safety

- Collects: account email (authentication); load postings you view and broker reports you submit (app functionality); anonymous device ID.
- Does NOT collect: broker contact PII (phone/email stripped in the browser before anything is sent); no location; no browsing history.
- Shared with third parties: No. Data goes only to the LoadLens backend.
- Sold: No.
- Encrypted in transit: Yes (HTTPS).
- Deletion: in-app («Удалить аккаунт» в попапе → `DELETE /api/v1/users/me`, hard-delete + каскад водителей); также по email.

## Screenshots (1280×800, до 5; заголовок крупно + строка под ним; фон #1d4ed8)

> Замазать реальные телефоны/email брокеров на всех скринах. Первый — самый важный (превью в выдаче).

1. **Every load, scored where you work**
   True $/mile after deadhead and fuel, an HOS feasibility badge, and broker trust on every row of the DAT One board.
   _Снять:_ `search-loads` с полосой бейджей под строками (выгодность · HOS · брокер · водитель).

2. **The full picture in one click**
   Rate versus market, real road miles, broker credit and days-to-pay, contacts, notes, and a booking link.
   _Снять:_ открытую карточку детали груза.

3. **Plan your way out of dead markets**
   LoadLens chains two or three loads ahead and ranks routes by the strength of the destination market.
   _Снять:_ панель с секцией get-out цепочек.

4. **Match every load to the right driver**
   See which of your drivers can run a load legally and profitably, ranked by net per mile.
   _Снять:_ чип `водитель (N/M)` на строке + разбивку «Кому подходит».

5. **Run your whole fleet**
   Add drivers with their market, trailer, and remaining hours. LoadLens handles the matching.
   _Снять:_ попап с секцией «Парк».
