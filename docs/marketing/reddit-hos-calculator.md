# Reddit: посты про HOS-калькулятор

Дата: 2026-09-30. Цель — трафик на бесплатный `/hos-calculator/` (ToS-чистый, к DAT не относится).
Расширение в постах НЕ продвигаем: публичность в англоязычных сообществах повышает риск реакции DAT
(ToS §1.2, прецедент DAT v. Convoy; первый лид ушёл после предупреждения DAT). Про расширение —
только если спросят в комментариях.

## Пост 1: r/Truckers (водители)

**Title:** I built a free HOS calculator that plans the whole trip, not just the next 11 hours. Looking for feedback from drivers

**Body:**

> You punch in how long you've driven today, when your shift started, when you last took your 30, and your hours for the week. It tells you what's left on the 11, the 14, the break clock and your 70 (or 60).
>
> The part I actually built it for: put in the loaded miles, average speed and how long loading takes, and it lays out the trip. Drive 6:40, take the 30, drive 4:20, 10 hour reset, and so on. If your cycle runs out on the road, it says so up front and tells you a 34 is coming.
>
> Free, no signup, works on a phone:
> https://loadlens.krait.studio/hos-calculator/?utm_source=reddit&utm_campaign=hos_calc&utm_content=truckers
>
> Running a split? Tick the box, enter your first rest, and it tells you how long the second one has to be and what you get back after it. The trip plan still assumes straight 10s. No adverse driving or short haul yet. It's a planning estimate, your ELD is what counts at a scale.
>
> Honest question: would a trip plan built on 7/3 or 8/2 be useful for you, or do most of you just run straight 10s? And if the math looks wrong anywhere, tell me. I'd rather hear it here than have someone plan a load on a bad number.

Почему так: польза + просьба о фидбеке, честно про ограничения, вопрос провоцирует обсуждение. DAT не упоминается.

## Пост 2: r/OwnerOperators (деньги)

**Title:** Quick way to check if a load is even legal before you book it

**Body:**

> Booked a load once that looked great on paper. 1,100 miles, pickup at 2pm, delivery next morning. Did the math at the truck stop and realized there was no legal way to make it without blowing the 14.
>
> So I put together a calculator for exactly that check. Enter your hours, enter the loaded miles, and it shows whether you make the appointment and where the breaks and resets land:
> https://loadlens.krait.studio/hos-calculator/?utm_source=reddit&utm_campaign=hos_calc&utm_content=ownerops
>
> Free, no account. Handles 70/8 and 60/7, the 30 minute break, 34 hour restart and split sleeper (7/3, 8/2) for the hours left.
>
> For those of you who dispatch yourselves: how do you check this now? In your head, on the ELD app, or just book it and figure it out?

**ВАЖНО:** первый абзац написан от первого лица. Публиковать только если история реальная. Иначе —
честная версия (выдуманную историю на Reddit разоблачат, домен забанят):

> Talking to an owner-op last month, he told me about booking a 1,100 mile load with a next-morning delivery and realizing at the truck stop it couldn't be done legally.

## Пост 3: диспетчеры (r/FreightBrokers или сабреддиты диспетчеров)

**Title:** Free HOS trip planner for dispatchers: can your driver make this pickup and delivery legally?

**Body:**

> Dispatch side question. When a load comes up, how do you check HOS before you commit? Call the driver, ask for their clocks, do the math on paper?
>
> I made a calculator for that step. Driver's current clocks go in, the load's miles go in, and you get a trip plan: drive blocks, the 30, 10 hour resets, and a warning if the cycle runs out and they'll need a 34.
>
> https://loadlens.krait.studio/hos-calculator/?utm_source=reddit&utm_campaign=hos_calc&utm_content=dispatch
>
> Free, no signup. It's an estimate for planning, not a replacement for the ELD.
>
> What would make this worth bookmarking for you? Multiple drivers at once? Appointment time as an input, so it tells you on time vs late?

Почему так: вопросы в конце ведут к тому, что уже есть в расширении (парк водителей, HOS-бейдж на
каждом грузе). Про расширение — только если спросят.

## Ответы в комментариях

**«Is this yours / are you selling something?»**
> Yeah, I built it. The calculator is free and stays free. I also make a Chrome extension for dispatchers that runs the same check on load board postings, that's the paid part. Didn't want to lead with it here.

**Нашли ошибку в расчёте:**
> Good catch, thanks. Can you share the numbers you put in? I'll fix it and reply here when it's live.

(После фикса действительно вернуться и ответить.)

**Про split sleeper:**
> It's in: tick "split sleeper" and it shows how long the second rest must be and what you get back. The trip plan still uses straight 10s. Would you use a plan built on 8/2 or 7/3?

**Про recap («Will it recap?», r/CDL, 01.10):**
> It does now. Tick "Enter hours by day" under the cycle field and put in your on-duty hours for today and the last 7 days. It shows how much comes back at midnight, and if you run out of cycle on the trip, the plan waits for the recap instead of a full 34 when that's quicker.

**На реплику «recap is a lost art, long haul adopted the 34 too willingly»** (похвала + история, вопроса нет → разговор, не фича, ссылку не повторять):
> Thanks. That history makes sense, a weekend off is a free 34 for a local guy. Long haul I think it just won because it's one number. "Take a 34" is easy to say over the phone, recap means someone has to actually keep the last 8 days in their head.
>
> That's the part I wanted to fix. The calculator does the day-by-day bookkeeping, so the plan shows "wait 6 hours for Tuesday to drop off" instead of a flat 34. Curious how you run it now, do you track your 8 days yourself or trust the ELD recap screen?

## Как публиковать

1. Прочитать правила каждого сабреддита (в r/Truckers самопромо часто только в отдельные дни/ветки); при сомнениях — написать модераторам.
2. Один пост в неделю, не три в один день — одинаковые ссылки в нескольких сабреддитах = спам-фильтр.
3. Аккаунт с историей: если новый — 1–2 недели отвечать в тредах про HOS без ссылок (правило 9:1).
4. Первые 2 часа после поста быть онлайн и отвечать.
5. `utm_content` у каждого поста свой — смотреть в Метрике, какой сабреддит сработал.

Нюанс: внизу страницы калькулятора блок «LoadLens runs this check on every load in DAT One». Для
минимального внимания DAT можно заменить на «your load board».

## Проверка сабреддитов (30.09)

- **r/Truckers** — пост закрыт по карме (у аккаунта 38 comment karma, порог не раскрыт). Сначала набрать карму комментариями.
- **r/OwnerOperators** — ПОСТ НЕ ПУБЛИКОВАТЬ: правила 7–8 запрещают рекламу приложений/сайтов («If you built an app for truckers, we don't care»). Только комментарии без ссылок. Правило 2: упоминание себя как диспетчера или dispatch-услуг **где угодно на Reddit** = бан там → пост 3 и ответ «extension for dispatchers» с этого аккаунта не публиковать или переформулировать («tool for people who plan loads»).
- **r/CDL** — ПОДХОДИТ: правило 5 разрешает редкое самопромо с явным раскрытием аффилиации; правило 6 — образовательный контент; правило 3 — без «DM me». Пост ниже.

## Пост 4: r/CDL (новички, образовательный)

**Title:** HOS for new drivers: the 4 clocks that decide your day (plus a free trip planner I built)

**Body:**

> Disclosure up front: I built the calculator linked below. It's free, no signup, nothing to buy on that page.
>
> When I talk to people in their first year, the same thing comes up: you know the rules from the permit book, but on a real load it's hard to tell how they stack. Quick version:
>
> - 11 hour driving limit: max driving after 10 consecutive hours off.
> - 14 hour window: starts when you come on duty, and it doesn't stop for breaks, fuel or waiting at the dock. Once it's gone, you're done driving until your next 10.
> - 30 minute break: required after 8 cumulative hours of driving. Off duty, sleeper, or on duty not driving all count.
> - 70/8 or 60/7 cycle: total on-duty time across 8 (or 7) days. A 34 hour restart resets it.
>
> The one that catches new drivers is the 14. Sit 4 hours at a shipper and you've lost 4 hours of driving window, even if your 11 is untouched.
>
> The calculator: you enter how long you've driven today, when your shift started, when you last took your 30, and your hours for the week. It shows what's left on each clock. Put in the load's miles and average speed and it lays out the trip: drive blocks, the 30, 10 hour breaks, and a warning if you'll need a 34 on the road. Split sleeper (7/3, 8/2) is supported for the hours-left part.
>
> https://loadlens.krait.studio/hos-calculator/?utm_source=reddit&utm_campaign=hos_calc&utm_content=cdl
>
> It's a planning estimate. Your ELD is what counts. No adverse driving or short haul exceptions yet.
>
> If you're in school or just starting out: which part of HOS confused you most? And if the math looks off anywhere, tell me here in the comments so everyone sees the fix.

Фразу «When I talk to people in their first year» оставить только если это правда (правило 5 — бан за маскировку).

## Пост 5: r/SideProject (разработчики, история постройки)

Публиковать 2–3.10 (r/CDL опубликован 30.09). Аудитория — билдеры: даёт фидбек и обратные ссылки, не водителей. Расширение/DAT не упоминать (решение 30.09).

Структура переписана 02.10 по образцу поста Juniper в r/SideProject (планировщик меню, см. ниже «Почему так»): боль от первого лица в заголовке, ссылка без регистрации в начале, «How it works» в три шага, факт «ранние тестеры уже повлияли» (у нас это реальный тред r/CDL про recap), три конкретных вопроса в конце.

**Title (≤300 симв.):**

I got tired of doing truck driver hours math by hand before every load, so I built a free HOS calculator. The federal rules are simple on paper and surprisingly nasty in code. No sign-up, would love honest feedback

**Body:**

> US truck drivers live by Hours of Service rules: 11 hours of driving, a 14 hour on-duty window, a 30 minute break after 8 hours of driving, and 70 hours in 8 days. Break them and it's a violation, or the truck gets parked at a roadside inspection.
>
> Every ELD shows the hours left right now. What it doesn't answer is the question a dispatcher asks before taking a load: "Can this driver make the delivery legally, and where do the breaks land?" I was doing that math on a notepad several times a day. So I built a page that does it in a few seconds.
>
> Try it free, no sign-up: https://loadlens.krait.studio/hos-calculator/?utm_source=reddit&utm_campaign=hos_calc&utm_content=sideproject
>
> How it works:
>
> 1. Enter the driver's clocks: driving this shift, time since the shift started, driving since the last 30 minute break, on-duty hours in the cycle. Or tick "enter hours by day" and type the last 8 days, so it can recap.
> 2. Enter the trip: loaded miles, average speed, minutes at loading and unloading.
> 3. It shows what's left on each limit and lays the trip out as a timeline: drive blocks, the 30, 10 hour breaks, and a warning if the weekly cycle runs out mid-trip. When waiting until midnight for recap hours is faster than a full 34 hour reset, it says so.
>
> What was harder than expected:
>
> - The clocks aren't independent. The 14 hour window keeps running while you wait at a dock, so 4 hours at a shipper can cost 4 hours of driving even if your 11 is untouched. Every step has to advance every clock, and whichever limit hits first wins.
> - Split sleeper (7/3 or 8/2) breaks the "one window per day" model. The first rest doesn't count against the 14, and you only know it was valid once the second part is done. I shipped it for the hours-left view only. The trip planner still assumes straight 10 hour breaks, and the page says so.
> - Empty input is not zero. "When did you last take your 30?" left blank has to mean "not today", not "just now". I got this wrong in the first version.
>
> Early feedback already changed it. The first comment from a driver was "will it recap?" It didn't. Now it does the day-by-day bookkeeping for the 70/8 cycle, which turned out to be the thing experienced drivers care about and most tools skip.
>
> Stack: vanilla JS, no framework, no backend. All the math runs in the browser, nothing is sent anywhere. The HOS engine is one pure module with 38 unit tests. The page is in English, Russian and Romanian, because a lot of US dispatchers are Eastern European.
>
> No ads, no sign-up. It's the free top of the funnel for a paid tool I'm building for people who plan truck loads, which is why it exists.
>
> Especially curious:
>
> 1. Does the result page make sense if you've never been near a truck?
> 2. Any HOS edge case I've probably missed? Texas intrastate is the one I already know about.
> 3. Would you keep this a plain page, or make it a PWA that works offline? Drivers don't always have signal.

**Почему так (разбор поста Juniper, r/SideProject, 02.10):**
- Заголовок = боль от первого лица + «so I built» + «no sign-up» + просьба о фидбеке. Технический крючок («nasty in code») оставлен: для r/SideProject это причина открыть пост.
- Ссылка стоит до «How it works», как у Juniper: кто не читает дальше, всё равно кликнет.
- «Early feedback already changed it» — честный аналог «early testers shaped it»: история про recap реальная (тред r/CDL, 01.10). Выдуманных отзывов не добавлять.
- Три вопроса конкретные, два из трёх — для билдеров, не для водителей (в r/SideProject водителей нет).
- Юмора и эмодзи нет сознательно: пост технический, аудитория инженерная.

**Что НЕ делать:** не упоминать расширение, DAT, Truckstop, авто-пилот. Ответы на «а что за paid tool?» в комментариях — одной строкой: «a planning tool for dispatchers, not launched yet, happy to DM when it is».

### Вариант B: пост про само расширение (НЕ рекомендован, против решения 30.09)

Записан на случай, если решение пересмотрим. Риски: публичный англоязычный пост «расширение поверх DAT» = внимание DAT (ToS §1.2, первый лид ушёл после предупреждения DAT), а r/SideProject не даёт целевых пользователей: диспетчеров там нет, конверсия будет около нуля при полном риске. Если всё-таки публиковать: без названия борда («the big US load boards»), без авто-пилота, без скриншотов выдачи DAT.

**Title:** I got tired of watching dispatchers do rate per mile on a calculator while the good loads disappear, so I built a Chrome extension that scores every load on the board they already use

**Body:**

> Truck dispatchers spend the day on load boards: thousands of postings, each one "Chicago to Dallas, 920 miles, $2,400". Whether that's a good load depends on things the board doesn't show: how far the truck has to drive empty to pick it up, what fuel costs, whether the driver has the legal hours to make the delivery, and whether the broker actually pays. People do this on a calculator, per load, all day.
>
> So I built a Chrome extension that does it on the page. You keep using your load board, it adds a badge to every row.
>
> How it works:
>
> 1. Set your truck up once: cost per mile, trailer type, the driver's hours left.
> 2. Search for loads as usual. Every row gets a green, amber or red badge: true rate per mile after deadhead and fuel, against your break-even and your target.
> 3. A side panel shows the hot loads first, the HOS check (can the driver legally make it), broker credit score and days to pay, and a one-click email draft to the broker with a counter-offer.
>
> The extension never calls the board's API. It reads what your own signed-in session already loaded, which is the same line the other tools in this space draw.
>
> It's early. The free tier does the badges, the paid tier adds market rates per lane and a planner that looks two or three loads ahead to get a truck out of a dead market.
>
> Try it: https://loadlens.krait.studio/?utm_source=reddit&utm_campaign=extension&utm_content=sideproject
>
> Especially curious:
>
> 1. Would you build this as an extension again, or go for an API partnership first and accept the setup fee and 6 month delay?
> 2. How would you handle a site that changes its DOM every few weeks? I intercept the app's own JSON responses instead of parsing HTML, curious if others do the same.
> 3. What would make you trust a crowd-sourced "market rate" number from a tool with a few dozen users?


## r/SideProject (пост 5): ОПУБЛИКОВАН 02.10, 06:09 UTC

https://www.reddit.com/r/SideProject/comments/1wvm9kc/i_got_tired_of_doing_truck_driver_hours_math_by/

Через 3 часа — 0 комментариев (просмотры/голоса видны только в приложении, дописать). Добавлен свой комментарий
(~09:30 UTC) про баг «пустое поле ≠ ноль» и вывод «дефолт для пропущенного ввода — тот, что даёт более строгий план».
Дальше: цифры через 24 ч сюда; ответы на комментарии в первые часы.

## Тред r/CDL (пост 4): обмен с NonGMOman_ про recap, 01.10

Первый содержательный диалог в комментариях. Собеседник — локальный водитель из Техаса, интрастейт, с большим стажем (hazmat). Ход треда:

1. **NonGMOman_:** «Will it recap?»
2. **OP (мы):** It does now. Tick "Enter hours by day" under the cycle field and put in your on-duty hours for today and the last 7 days. It shows how much comes back at midnight, and if you run out of cycle on the trip, the plan waits for the recap instead of a full 34 when that's quicker.
3. **NonGMOman_:** Great job then. The reset was originally done to help local drivers who mostly were off on weekends. I don't know why long haul adopted it so willingly? Recap is sort of a lost art in most operations now.
4. **OP:** Thanks. That history makes sense, a weekend off is a free 34 for a local guy. Long haul I think it just won because it's one number. "Take a 34" is easy to say over the phone, recap means someone has to actually keep the last 8 days in their head. That's the part I wanted to fix. The calculator does the day-by-day bookkeeping, so the plan shows "wait 6 hours for Tuesday to drop off" instead of a flat 34. Curious how you run it now, do you track your 8 days yourself or trust the ELD recap screen?
5. **NonGMOman_:** I'm local so all I need to know is when I start. If I worked that much i'm now intrastate in Texas and don't have to fight a lot of the things interstate drivers do. I've also been doing it long enough that I could self-certify my medical if I was willing to give up my hazmat.
6. **OP (черновик ответа):**

> Fair enough, local is a different game. Know when you started, watch the clock, done.
>
> Texas intrastate is one I haven't touched. As I understand it that's 12 driving, 15 on duty, 70 in 7, and no mandatory 30. Is that still how it runs for you? I'm not going to chase every state exception, but if one is worth doing it's probably Texas.

**Выводы:**
- Recap (day-by-day) — реальный запрос, первый же вопрос в треде был про него; «recap is a lost art» — хорошая формулировка для будущих постов.
- Техасские интрастейт-правила (12h driving / 15h on-duty / 70h в 7 дней, без обязательного 30-мин перерыва) калькулятор не поддерживает. Если собеседник подтвердит цифры — добавить в список «не поддерживается» на странице калькулятора; кандидат на первое state-исключение.
- Тон, который работает: короткие ответы, вопрос собеседнику, без ссылок и продажи.

## Комментарий для кармы в r/SideProject, 01.10 (перед постом 5)

Пост u/hammerzzzzzz «AI Browser use»: хочет раз в день забирать race cards с сайта, который запрещает скрейпинг, API слишком дорогой; спрашивает про «AI, который открывает браузер». Тема наша (браузер в своей сессии vs скрейпинг/API), отвечаем без ссылок и без упоминания LoadLens.

**Черновик комментария:**

> "AI that opens a browser" is a real thing (Browser Use, OpenAI's Operator, Anthropic's Claude in Chrome), but for your case it's the expensive and flaky way to do it. You don't need an AI to click through a site once a day. You need a script.
>
> The cheap path:
>
> 1. Playwright (free, Python or Node). It drives a real Chrome. Log in once by hand, save the session, then a script opens the race card page every morning and dumps the HTML or the network responses. If the site loads cards via some JSON endpoint, grab that from the Network tab, it's usually much cleaner than the HTML.
> 2. Parse it. This is the only place AI is worth using, and even then just once: paste a sample of the page into ChatGPT/Claude and ask for a parser. Then run that parser every day for free.
> 3. Do your calculations on the result.
>
> Two things to check before you build it. First, "doesn't allow scraping" usually means the ToS forbids it, and a browser agent doesn't change that, it's still you pulling their data with a bot. For a personal, once-a-day, non-redistributed pull most sites won't notice or care, but if they block your account you'll know why. Second, some racing data providers have a hobbyist tier that's a lot cheaper than the enterprise API price you probably saw. Worth one email asking.
>
> If the site is heavy on bot detection, the lightest option is a bookmarklet or a tiny browser extension: you open the page yourself, click a button, it copies the table into a file. No automation for them to detect, and it's about 30 lines of JS.

Зачем: комментарная карма перед постом 5 (r/SideProject) и r/Truckers; позиция по ToS та же, что у нас с DAT; концовка про расширение в своей сессии — наша экспертиза, но без саморекламы.
