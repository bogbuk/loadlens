# LoadLens — Chrome Web Store listing

Готовый текст для публикации (аудитория — диспетчеры/owner-operators на DAT One / Truckstop, США).
Privacy policy: https://loadlens.krait.studio/privacy.html

## Name (из manifest `name`, ≤ 75 симв.; поиск CWS сильнее всего весит название и краткое описание)

`LoadLens: Rate per Mile, HOS & Broker Check for DAT One` (55)

Почему так: в начале слова, которые реально вбивают в поиск (rate per mile, HOS, broker check), бренд
борда в конце. **Truckstop в названии нет сознательно**: DOM-селекторы Truckstop всё ещё заглушки,
пользователь Truckstop поставит расширение, ничего не увидит и оставит единицу. Вернуть в название,
когда адаптер проверен на живой сессии.

Альтернативы:
- `LoadLens: True Rate per Mile & HOS Check for DAT One Load Board` (63) — есть «load board», но длиннее.
- `LoadLens: Load Board Assistant for DAT One Dispatchers` (54) — если модерация придерётся к «for DAT One».

## Short description (из manifest `description`, ≤ 132 симв.)

`True rate per mile after deadhead and fuel, HOS check and broker credit on every DAT One load. For dispatchers and owner-operators.` (131)

## Detailed description (правится в дашборде CWS, без нового пакета)

Первые две строки видны без «Read more» — в них суть и ключевые слова. Эмодзи и списки ключевых слов
не использовать: правило CWS против keyword spam.

```
Know what a load really pays before you call the broker.

LoadLens is a Chrome extension for truck dispatchers and owner-operators who book freight on DAT One. It puts a profit badge, an Hours-of-Service check and a broker trust score on every load, right on the board you already use. No spreadsheet, no calculator, no second screen.

FREE: WHAT YOU SEE ON EVERY LOAD

• True rate per mile. The rate divided by loaded miles plus deadhead to pickup, with fuel counted in. Green, amber or red against your own cost per mile and target $/mile.
• HOS check. The badge tells you whether the driver can run the load legally under the 11-hour, 14-hour, 30-minute break and 70-hour/8-day rules.
• Broker check. DAT credit score and days to pay on one chip, so slow payers stand out before you haul.
• Posting age. Each load shows how fresh it is, and the hot loads list puts the newest first.
• One-click broker email. A Gmail draft with lane, miles, pickup date and a counter-offer above your break-even. You read it and press Send. Call and copy-email buttons are right next to it.
• Side panel. Hot loads, trailer filter, sorting and a full load card next to your search results.
• Rate the brokers you worked with: paid, slow, flaked, double-brokered.

PRO: FOR DISPATCHERS RUNNING A FLEET
Every new account gets 14 days of Pro free.

• Market rate per lane and destination market strength from the LoadLens database.
• Get-out planner. Stuck in a dead market? LoadLens looks two or three loads ahead and ranks routes by how strong the destination market is. Sometimes a fair load that puts the truck where the freight is beats sitting a day.
• Fleet matching. Add drivers with location, trailer and hours left. Every load shows which driver it fits best and how many can run it.
• Telegram alerts with your own rules: minimum rate, max deadhead, states, trailer, broker MC, keywords like "in-bond". Matching loads arrive with the broker's phone and email.
• Reports on brokers from other carriers, current diesel price, CSV export, up to 3 devices.

HOW IT WORKS

1. Add LoadLens to Chrome (version 116 or newer).
2. Search for loads on DAT One as usual.
3. Click the LoadLens icon to open the side panel. Badges appear on your results.

You need your own DAT One account. LoadLens is not a load board: it works on top of your subscription. Truckstop support is in early beta.

PRIVACY

LoadLens reads the load data your own signed-in session already loaded. It does not sign into anything for you and never sends its own requests to the board. The loads you view, including broker contact details and posting comments when the board shows them, are sent to the LoadLens server to build market rates and route plans. They are never linked to you, and other users never see broker contacts or comments. Telegram alerts include the broker's contact details so you can call or email right away. Full policy: https://loadlens.krait.studio/privacy.html

Not affiliated with DAT Solutions or Truckstop.
Questions or feedback: hello@krait.studio
Website: https://loadlens.krait.studio
```

## Store fields

- Category: Workflow & Planning (или Productivity)
- Language: English
- Privacy policy URL: https://loadlens.krait.studio/privacy.html

## Permission justifications

- `storage` — saves your login session and caches settings and market data locally so the extension works fast and offline.
- `sidePanel` — shows the LoadLens panel (scored loads, route planner, load details, settings) in Chrome's side panel next to the load board instead of covering the board's results.
- Host `*.dat.com` / `*.truckstop.com` — reads the loads rendered on the board pages you open, to score them and draw badges.
- Host `loadlens.krait.studio` — the extension's own backend for accounts, lane-rate medians, and broker reputation.
- Remote code: No. All logic ships inside the package.

## Data safety (Privacy practices в dashboard — должно совпадать с privacy.html, иначе нарушение политики CWS)

Обновлено 2026-09-25: с 2026-07-17 контакты брокеров и comments сохраняются на сервере (см. CLAUDE.md, ToS/PII).

Галочки «What user data do you plan to collect»:
- **Personally identifiable information** — да: email аккаунта; телефоны/email брокеров из постингов; имена водителей.
- **Authentication information** — да: пароль (хэш на сервере), токены сессии; DAT-сессия в облачном браузере.
- **Personal communications** — нет (Telegram — только исходящие алерты нашим ботом).
- **Website content** — да: постинги грузов с DAT/Truckstop (включая comments).
- **User activity** — нет (клики/нажатия не пишем; авто-пилот не логирует действия).
- **Location / Health / Financial and payment / Web history** — нет.

Три сертификации Limited Use — отметить все (не продаём, не для несвязанных целей, не для кредитоспособности).

Итог для текстов:
- Collects: account email and password hash; loads you view incl. broker contacts and comments (not linked to the user); install ID and device last-seen; driver profiles; broker reviews; Telegram chat ID; cloud browser profile (incl. the DAT session) for Pro Cloud.
- Shared: other users — only aggregates and load summaries without contacts; Telegram — alerts to the user's own chat; hosting — Hetzner (DE).
- Sold: No.
- Encrypted in transit: Yes (HTTPS).
- Deletion: in-app (боковая панель → Settings → Delete account → `DELETE /api/v1/users/me`: аккаунт, водители, устройства, Telegram, облачный браузер сразу); крауд-грузы и отзывы не привязаны к юзеру и остаются; также по email.

## Screenshots (1280×800, до 5; заголовок крупно + строка под ним; фон #1d4ed8)

> Замазать реальные телефоны/email брокеров на всех скринах. Первый — самый важный: он же превью в выдаче
> CWS, и на нём решают, открыть карточку или нет. Подписи повторяют слова из поиска.

1. **True rate per mile on every DAT One load**
   Profit after deadhead and fuel, HOS and broker credit, right on the board.
   _Снять:_ выдачу DAT с полосой бейджей под строками + открытая боковая панель.

2. **Email the broker with a counter-offer in one click**
   Lane, miles, pickup date and a price above your break-even. You press Send.
   _Снять:_ карточку груза в панели + открытый черновик Gmail.

3. **Hot loads, freshest first**
   Filter by trailer, sort by true $/mile, open any load in one click.
   _Снять:_ вкладку Loads боковой панели со списком «Выгодные сейчас».

4. **Loads that match your rules, straight to Telegram** (PRO)
   Minimum rate, max deadhead, states, keywords like "in-bond". Broker phone and email included.
   _Снять:_ сообщение бота в Telegram + редактор правил в Settings.

5. **Get out of dead markets** (PRO)
   Two or three loads ahead, ranked by how strong the destination market is.
   _Снять:_ секцию get-out цепочек в панели.

## Промо-плитка (440×280)

`True $/mile on every DAT One load` + иконка. Больше текста на плитке не читается.
