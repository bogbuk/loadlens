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

## Локализованные описания (RU, RO)

Дашборд CWS → Store listing → выпадающий список языка → добавить `Russian` и `Romanian` → вставить
Detailed description. Магазин показывает их пользователям Chrome на этом языке, у конкурентов их нет.
Название и краткое описание остаются английскими: их локализация требует `_locales/` в пакете
(отдельное решение; плюс английские поисковые слова «rate per mile», «DAT One» русскоязычные
диспетчеры всё равно вбивают по-английски). Строка «Интерфейс на английском» обязательна: UI
расширения только EN, обещать русский интерфейс нельзя. Абзац о приватности — дословный перевод
английского (он сверен с privacy.html). RO не вычитан носителем.

### Russian

```
Узнайте, сколько реально платит груз, ещё до звонка брокеру.

LoadLens — расширение Chrome для диспетчеров и овнер-операторов, которые ищут грузы на DAT One. У каждого груза прямо на борде появляются бейдж выгодности, проверка HOS и оценка брокера. Без таблиц, калькулятора и второго экрана.

БЕСПЛАТНО: ЧТО ВИДНО НА КАЖДОМ ГРУЗЕ

• Реальная ставка за милю (rate per mile). Ставка делится на мили с грузом плюс пустой пробег до погрузки (deadhead), с учётом топлива. Зелёный, жёлтый или красный относительно вашей себестоимости мили и целевого $/миля.
• Проверка HOS. Бейдж показывает, успеет ли водитель легально: правила 11 часов, 14 часов, 30-минутного перерыва и 70 часов за 8 дней.
• Проверка брокера. Кредитный рейтинг DAT и срок оплаты в одном бейдже: тех, кто тянет с оплатой, видно ещё до рейса.
• Свежесть объявления. У каждого груза видно, как давно его выставили, а список выгодных грузов начинается со свежих.
• Письмо брокеру в один клик. Черновик в Gmail с направлением, милями, датой погрузки и контр-оффером выше вашей точки безубыточности. Вы читаете и сами нажимаете «Отправить». Рядом кнопки звонка и копирования email.
• Боковая панель. Выгодные грузы, фильтр прицепа, сортировка и полная карточка груза рядом с результатами поиска.
• Оценки брокеров, с которыми вы работали: оплатил, тянул с оплатой, сорвал груз, двойной брокеридж.

PRO: ДЛЯ ДИСПЕТЧЕРОВ С ПАРКОМ
Каждый новый аккаунт получает 14 дней Pro бесплатно.

• Рыночная ставка по направлению и сила рынка в точке доставки из базы LoadLens.
• Планировщик выезда. Застряли в мёртвом рынке? LoadLens смотрит на два-три груза вперёд и ранжирует маршруты по силе рынка доставки. Иногда груз со средней ставкой, который привезёт трак туда, где есть грузы, лучше суток простоя.
• Подбор водителя. Добавьте водителей с локацией, прицепом и остатком часов. На каждом грузе видно, кому он подходит лучше и скольким вообще.
• Алерты в Telegram по вашим правилам: минимальная ставка, максимум пустого пробега, штаты, прицеп, MC брокера, ключевые слова вроде «in-bond». Подходящие грузы приходят с телефоном и email брокера.
• Отзывы других перевозчиков о брокерах, актуальная цена дизеля, экспорт в CSV, до 3 устройств.

КАК ЭТО РАБОТАЕТ

1. Установите LoadLens в Chrome (версия 116 или новее).
2. Ищите грузы на DAT One как обычно.
3. Нажмите на иконку LoadLens, чтобы открыть боковую панель. Бейджи появятся на результатах поиска.

Нужен свой аккаунт DAT One. LoadLens не является бордом грузов: он работает поверх вашей подписки. Поддержка Truckstop в ранней бете. Интерфейс расширения на английском.

ПРИВАТНОСТЬ

LoadLens читает данные о грузах, которые уже загрузила ваша собственная сессия. Он ни в какие аккаунты не входит за вас и никогда не отправляет собственных запросов к борду. Грузы, которые вы просматриваете, включая контакты брокеров и комментарии к объявлениям, когда борд их показывает, отправляются на сервер LoadLens для расчёта рыночных ставок и планов маршрутов. Они никогда не привязываются к вам, и другие пользователи не видят контакты брокеров и комментарии. Алерты в Telegram содержат контакты брокера, чтобы вы могли сразу позвонить или написать. Полная политика (на английском): https://loadlens.krait.studio/privacy.html

Не связан с DAT Solutions и Truckstop.
Вопросы и отзывы: hello@krait.studio, можно писать по-русски.
Сайт: https://loadlens.krait.studio/ru/
```

### Romanian

```
Află cât plătește de fapt o cursă înainte să suni brokerul.

LoadLens este o extensie Chrome pentru dispeceri și owner-operatori care caută curse pe DAT One. Fiecare cursă primește direct pe board un badge de profit, o verificare HOS și un scor de încredere pentru broker. Fără tabele, fără calculator, fără al doilea ecran.

GRATUIT: CE VEZI LA FIECARE CURSĂ

• $/milă real (rate per mile). Tariful împărțit la milele încărcate plus milele goale până la încărcare (deadhead), cu tot cu combustibilul. Verde, galben sau roșu față de costul tău pe milă și de ținta ta de $/milă.
• Verificare HOS. Badge-ul îți arată dacă șoferul poate face cursa legal după regulile de 11 ore, 14 ore, pauza de 30 de minute și 70 de ore în 8 zile.
• Verificarea brokerului. Scorul de credit DAT și termenul de plată într-un singur badge, ca să vezi rău-platnicii înainte de cursă.
• Vechimea anunțului. La fiecare cursă vezi de cât timp e postată, iar lista curselor bune începe cu cele mai noi.
• Email brokerului dintr-un clic. O ciornă în Gmail cu ruta, milele, data încărcării și o contraofertă peste pragul tău de rentabilitate. Tu o citești și apeși Send. Lângă ea ai butoane de apel și de copiere a emailului.
• Panou lateral. Curse bune, filtru de remorcă, sortare și fișa completă a cursei lângă rezultatele căutării.
• Evaluezi brokerii cu care ai lucrat: a plătit, plătește greu, a anulat, double-brokering.

PRO: PENTRU DISPECERI CU FLOTĂ
Fiecare cont nou primește 14 zile de Pro gratuit.

• Tariful pieței pe rută și puterea pieței de destinație din baza LoadLens.
• Plan de ieșire. Blocat într-o piață moartă? LoadLens se uită la două-trei curse înainte și ordonează rutele după cât de puternică e piața de la destinație. Uneori o cursă cu tarif mediu care duce camionul acolo unde e marfă e mai bună decât să stai o zi pe loc.
• Potrivire pe șoferi. Adaugă șoferii cu locația, remorca și orele rămase. La fiecare cursă vezi cui i se potrivește cel mai bine și câți o pot face.
• Alerte în Telegram după regulile tale: tarif minim, deadhead maxim, state, remorcă, MC-ul brokerului, cuvinte cheie ca „in-bond”. Cursele potrivite vin cu telefonul și emailul brokerului.
• Rapoarte despre brokeri de la alți transportatori, prețul actual al motorinei, export CSV, până la 3 dispozitive.

CUM FUNCȚIONEAZĂ

1. Adaugă LoadLens în Chrome (versiunea 116 sau mai nouă).
2. Caută curse pe DAT One ca de obicei.
3. Apasă pe iconița LoadLens ca să deschizi panoul lateral. Badge-urile apar pe rezultatele căutării.

Ai nevoie de propriul cont DAT One. LoadLens nu este un load board: funcționează peste abonamentul tău. Suportul pentru Truckstop e în beta timpurie. Interfața extensiei este în engleză.

CONFIDENȚIALITATE

LoadLens citește datele despre curse pe care sesiunea ta le-a încărcat deja. Nu se loghează nicăieri în locul tău și nu trimite niciodată cereri proprii către board. Cursele pe care le vezi, inclusiv contactele brokerilor și comentariile din anunțuri atunci când board-ul le afișează, sunt trimise la serverul LoadLens pentru a calcula tarifele pieței și planurile de rută. Nu sunt legate niciodată de tine, iar alți utilizatori nu văd contactele brokerilor sau comentariile. Alertele din Telegram includ contactele brokerului, ca să poți suna sau scrie imediat. Politica completă (în engleză): https://loadlens.krait.studio/privacy.html

Nu este afiliat cu DAT Solutions sau Truckstop.
Întrebări și sugestii: hello@krait.studio, ne poți scrie și în română.
Site: https://loadlens.krait.studio/ro/
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
