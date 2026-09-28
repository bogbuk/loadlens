# Что DAT говорит о расширениях вроде LoadLens (ресерч 2026-09-26)

Источники — официальные документы DAT, все с датой **Last Updated: July 30, 2026**:
[Terms and Conditions](https://www.dat.com/terms-and-conditions),
[Acceptable Use Policy](https://www.dat.com/acceptable-use-policy),
[Product and Delivery Schedule](https://www.dat.com/product-and-delivery-schedule),
[DAT One Help — Browser Troubleshooting](https://one.support.dat.com/9-troubleshooting-2734b01a/browser-troubleshooting-cda03b1c).
Цитаты ниже — дословно из текста страниц (скачаны curl'ом 26.09).

## 1. Прямой запрет расширений — ToS §1.2 (Automation)

> You are prohibited from using, or enabling others to use, any automated means including but not limited to
> implementing a bot, AI agent, spider, **a browser extension or plug-in**, or web crawler to access, query, or
> otherwise generate traffic to collect, copy, obtain, or extract any Product Data (such as web scraping, data
> scraping) without prior written approval from Us. **We may in Our discretion establish thresholds for or other
> mechanisms of monitoring and limiting queries and access in order to enforce this provision.**

- «enabling others to use» — формально задевает и нас как поставщика, а не только пользователя.
- Вторая фраза новая для наших заметок: DAT прямо оставляет за собой пороги/мониторинг запросов.
- Нарушение §1.2 → **немедленное** расторжение/приостановка «in Our reasonable belief», без 10-дневного
  окна на исправление (§4.4 Termination for Cause). Для прочих нарушений окно 10 дней есть.

## 2. ★ Лимит 500 поисков в месяц — Product and Delivery Schedule, DAT One → Use Limitations

> Your load search activity in DAT One is monitored by Us. Search activity in excess of five hundred (500)
> searches per user per month will be considered breach of the Agreement.

Это самый практичный пункт: не про «расширение» как таковое, а про **объём** — и именно его генерирует
авто-пилот. Там же (раздел Monitoring): DAT мониторит использование, «including without limitation, the use of
unauthorized automation tools». В ToS §5.2.2(e)(ii) дополнительно запрещено использовать продукт «in a way
intended to … exceeding usage limits or quotas».

Грубая оценка по `extension/autopilot-policy.js` (что считается «поиском» — DAT не определяет; предполагаем,
что считается каждый FindLoads-bootstrap, т.е. наш `location.reload()` / клик SEARCH):
- reload не чаще раза в 15 мин и только при протухшей выдаче (>10 мин без FindLoads) — а без reload выдача
  протухает сама, так что на практике ~3–4 reload/час на вкладку;
- окно тишины 22–5 → ~17 активных часов → **~1500–2000 поисков/мес на одну вкладку**, облако — так же, но
  круглые сутки на всех днях;
- плюс собственные поиски пользователя; `fetchMore` при скролле, возможно, тоже считается.

500/мес ≈ 16 поисков в день ≈ 1 поиск в час за рабочий день. **Авто-пилот в текущем виде превышает лимит
в 3–4 раза даже одной вкладкой.** Это самое правдоподобное объяснение предупреждения, которое получил друг
первого лида 15.09 (см. memory `lead-owner-op-fontana-alert-rules`) — снижение футпринта 15.09 уменьшило
частоту, но не до 500/мес.

## 3. AUP: «повторяющиеся поиски» и общие логины

> To transmit bona fide posts, truck availability posts, or **load searches made repeatedly in such a way as
> to game the Platform**.

> Through shared logins; logins are issued on a per-Authorized User basis and Authorized Users may not give a
> login to any other person, including without limitation **unauthorized third-party service integrators**
> (iPaaS platforms, uncertified TMS integrations).

- Первый пункт — ещё один крючок на авто-обновление.
- Второй — риск для **LoadLens Cloud**: сессия пользователя живёт на нашей инфраструктуре. Логин мы не
  храним (пользователь входит сам через noVNC), но DAT может трактовать это как передачу логина
  «неавторизованному интегратору».
- Enforcement: «We may also withhold investigation details and methods» — DAT не обязан объяснять, за что
  именно заблокировал.

## 4. Запрет конкуренции — ToS §5.2.2 + определение «Compete»

> (a) during the Term and for three (3) years thereafter You will not Compete; (b) in perpetuity You will not
> use the Products or Product Data … to Compete; (c) in perpetuity You will not reproduce, republish, resell,
> disclose, or distribute Product or Product Data … for sale or use by third parties

> "Compete" means to directly or indirectly develop for sale, sell or offer to sell products that
> (i) aggregate other brokers' loads or freight match other brokers' loads, **(ii) index or project shipping
> lane rates**, …

Касается любого, кто сам подписан на DAT (включая нас, если у основателя/тестового аккаунта есть подписка):
крауд-медиана ставок по lane (`backend/lanes`) и крауд-база грузов (`backend/loads`) прямо попадают в (i)/(ii).
Для пользователей: пересылка их Product Data нам на бэкенд → раздача агрегата другим Pro — это (c)
«distribute … for use by third parties». Нарушение §5.2.2 — тоже немедленное расторжение, плюс DAT
заявляет право на аудит «Your premises» и injunctive relief без залога (§5.2.4).

§5.2.3: запрещено обучать на Product Data публично доступные AI/ML-модели — нас сейчас не касается, но
держать в голове при любых «AI-фичах».

## 5. Что DAT НЕ говорит

- Публичных заявлений/новостей о блокировке конкретных расширений (LoadConnect, LoadHunter, Loadboard Ninja,
  Dispatch Robot, Superload) не нашли; все они в Chrome Web Store и работают. LoadHunter при этом — партнёр
  **Truckstop** Marketplace, не DAT.
- Прецедентов судов DAT против расширений в 2025–26 не нашли (единственный заметный иск — OTR Solutions,
  факторинг, закрыт в июне 2025). Convoy остаётся главным прецедентом.
- Help center DAT про расширения говорит только техническое: «Some extensions might cause issues on how our
  website behaves» — советует отключить при проблемах. Детектора/предупреждения «у вас расширение» публично нет.
- Лимита одновременных сессий в документах нет (наше наблюдение «одна сессия на аккаунт» — поведение
  приложения, а не пункт договора).
- Для сравнения: официальный Freight Matching API — 60 поисков/час, 1000/мес, только после сертификации.

## Выводы для LoadLens

1. **Риск ранжирован:** (1) авто-пилот — нарушает понятный измеримый лимит 500/мес, DAT его мониторит, и это
   уже дало предупреждение реальному пользователю; (2) крауд-БД ставок/грузов — «Compete» + редистрибуция,
   но это риск компании, а не аккаунта пользователя; (3) Cloud — shared-login трактовка; (4) пассивный overlay
   (бейджи/скоринг из того, что пользователь и так загрузил) — формально под §1.2 «extract Product Data»,
   но это та же зона, где годами живут конкуренты.
2. **Авто-пилот:** либо жёсткий бюджет поисков в месяц на аккаунт (счётчик в `chrome.storage`, дефолт заметно
   ниже 500 с учётом ручных поисков, видимый пользователю), либо отказ от reload в пользу только SSE
   live-матчей (они не создают поисков — поток открывает сам DAT). Облачный режим с форсированным
   авто-пилотом в текущем виде гарантированно выходит за 500.
3. В онбординге/листинге честно предупредить про лимит 500 поисков DAT — это снимет сюрприз «warning».
4. Долгосрочно единственный чистый путь — «prior written approval» (§1.2) = трек Solutions Integrations Partner.
5. Не знаем, что именно DAT считает «search» — стоит проверить на своём аккаунте, есть ли в DAT One счётчик
   или письмо при приближении к лимиту.
