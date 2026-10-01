# Приём оплаты подписки LoadLens без SRL/ÎI (физлицо из Молдовы, + румынские документы и Revolut)

Дата: 2026-10-01. Ресерч (Fable 5.1). Пометки: **[офиц.]** — по официальной документации сервиса/госоргана;
**[косв.]** — по вторичным источникам; **[не подтверждено]** — подтверждения не найдено.
Налоговая часть — не юрконсультация, проверить у местного бухгалтера.

## 0. Что меняет картину

1. **С 01.01.2026 в Молдове — «Legea freelancerilor» (Закон 228/2025, гл. 10⁴ НК), режим «antreprenor independent».**
   Не SRL и не ÎI: бесплатная онлайн-регистрация (EVO/servicii.gov.md, e-подпись), IDNO за 24 ч, единый налог
   **15%** (подоходный + CAS + CASS + местные сборы) до 1,2 млн лей/год, выше — 35% на превышение; **без бухгалтерии
   и деклараций**; нужен выделенный счёт в молдавском банке/у провайдера по Закону 114/2012; СФС считает налог по
   оборотам счёта, уведомление до 10-го, оплата до 25-го через MPay. В списке 40 видов деятельности — **62.01** и
   **62.02** [косв., contabilitate.md]. Совмещается с наймом [косв., cor.md]. [офиц.] mded.gov.md, cnas.gov.md.
2. **Stripe с 25.02.2026 добавил Молдову в cross-border payouts** [офиц., changelog Stripe] — поэтому **Polar.sh
   официально поддерживает выплаты в Молдову** [офиц., polar.sh/docs].

## 1. Сравнение

| Сервис | Физлицо из MD | Payout в MD | Подписки + вебхуки | Комиссия | Риски |
|---|---|---|---|---|---|
| **Paddle** (MoR) | **Да** [офиц.]: для individual бизнес-верификация пропускается, только ID + адрес (Sumsub, liveness); MD не в санкционном списке [офиц.], поддерживается [косв.] | Банк (SWIFT $15), PayPal, Payoneer; мин. $100; 1-го числа [офиц.] | Да, полный billing | **5% + $0.50** [офиц.] | Жёсткий андеррайтинг соло-основателей; смотрят сайт (pricing, ToS, privacy, refund), совпадение заявитель = домен = счёт [косв.] |
| **Lemon Squeezy** (MoR) | Да, KYC по ID [офиц.] | MD в списке bank payouts + PayPal [офиц.] | Да | 5% + $0.50 | Куплен Stripe, миграция в Stripe Managed Payments (MD нет) [косв.]; жалобы на блокировки 2025 [косв.] |
| **Polar.sh** (MoR) | Да, individual через Stripe Connect Express, страна = проживание [офиц.]; MD в списке | Через Stripe Connect; счёт в стране резидентства, локальная валюта [офиц.] — уточнить USD-счёт в MD | Да: подписки, вебхуки, license keys, Node SDK | 5% + 50¢ (Starter) [косв.] | Рельс в MD новый (02.2026); молодая компания |
| **Creem.io** (MoR) | Да [офиц.]; MD и RO в списке | Межд. payout $7 или 1%; мин. $50 | Да | **3.9% + $0.40** [офиц.] | Trustpilot: блокировки при запросе выплаты [косв.] |
| **Dodo Payments** (MoR) | Да: право по **стране ID** (MD и RO в списке) [офиц.] | SWIFT $25, Payoneer; мин. $50 | Да | 4% + 40¢ +0.5% подписки +1.5% межд. карты (~6% для карт США) [офиц.] | Стартап 2024; жалобы на удержание до 120 дней [косв.] |
| **Gumroad** | Да | MD с 11.2024 [косв.] | Memberships + Ping-вебхуки | **10% + $0.50** [косв.] | Дорого, витрина для креаторов |
| **FastSpring** | [не подтверждено] | Банк; холд 45 дней [косв.] | Да | ~5.9% + $0.95 [косв.] | Enterprise, sales-led |
| **2Checkout/Verifone** | [не подтверждено] | Банк/PayPal | 2Monetize 6% + $0.60 [косв.] | Легаси, жалобы на удержания |
| **Payhip** | Не MoR для карт — нужен свой Stripe/PayPal | — | Слабые вебхуки | — | Не подходит |
| **Freemius** | Да [офиц.] | PayPal, Payoneer, wire, Wise; мин. $100 [офиц.] | Подписки да | 4.7% + gateway [офиц.] | Экосистема WordPress — запасной |
| **PayPal (MD)** | Доступен [косв.] | Вывод только на Visa, 96 MDL + конверсия 4% [офиц.] | Subscriptions у Business [не подтверждено] | ~4.4–5% + конверсия | Холды; только как доп. канал |
| **Крипто** | Без KYC | Кошелёк | Рекуррента нет | низкая | Для траковщиков США нереалистично |
| **Stripe RO Individual без PFA** | **Нет** (см. §2) | — | — | — | Нарушение условий резидентства |

## 2. Румынские документы + личный Revolut

- **Revolut Personal для бизнес-выплат — нет.** Условия запрещают бизнес-использование, риск заморозки выплат [косв.].
- **Revolut Business** — только для зарегистрированных SRL/PFA/ÎI [косв.]; **Revolut Pro** привязан к адресу профиля;
  для режима antreprenor independent выделенный счёт должен быть в **молдавском** банке.
- **«Individual из Румынии»** — MoR (Paddle, Polar, Lemon Squeezy) определяют страну по **фактическому проживанию**;
  заявить RO, живя в MD, — misrepresentation при KYC → закрытие и удержание средств. Исключение — Dodo (по стране ID).
  Все топ-MoR поддерживают Молдову напрямую — регистрироваться как резидент MD.
- **Stripe RO Individual** — «only businesses (incl. sole proprietors) located in Romania» [офиц., SSA RO]; при
  проживании в MD — нарушение условий; по праву RO систематическая деятельность требует PFA. Stripe Managed Payments
  (~35 стран) Молдову не поддерживает [косв.].

## 3. Рекомендации

### №1 — Paddle как физлицо-резидент Молдовы
1. Лендинг: публичный pricing с суммой и периодом, Terms, Privacy (есть), **Refund policy**, контакт, описание Chrome-расширения; домен в заявке = loadlens.krait.studio.
2. Регистрация Individual/Sole trader, страна Moldova; domain review; Sumsub (паспорт MD + подтверждение адреса).
3. Payout: Payoneer (USD) или USD-счёт в MD-банке; после регистрации antreprenor independent — выделенный счёт.
4. Paddle Billing: overlay checkout, вебхуки `subscription.activated|updated|canceled|past_due` → `plan`/`pro_until`.
5. Отказ — переподать по замечаниям и параллельно №2.

### №2 — Polar.sh (запасной/параллельный)
Individual (country of residence = Moldova) → Stripe Connect Express → счёт в молдавском банке (заранее уточнить
MDL/USD) → вебхуки `subscription.*`. Проверить первой выплатой $50+.

Creem/Dodo — дешевле, но повторяющиеся жалобы на заморозку средств; Dodo — третий вариант. Lemon Squeezy — не начинать.

## 4. Налоги (Молдова; проверить у бухгалтера)

- Резидент MD платит 12% с мирового дохода (CET18 до 30 апреля). Но регулярная продажа подписок — предпринимательская
  деятельность: без регистрации — ст. 263(1) КоП, штраф 30–90 у.е. (1 500–4 500 лей) + доначисления; в мае 2026 СФС
  оштрафовала 640 человек [офиц. текст статьи; косв. bancamea.md]. «Физлицо + CET18» — только для первых тестовых платежей.
- **Antreprenor independent (15%)** — регистрироваться с первой реальной подписки. Уточнить: (а) подпадает ли SaaS-подписка
  под 62.01/62.02; (б) валютные поступления от иностранного MoR на выделенный счёт; (в) MoR как единственный «клиент».
  SRL/IT-park (7%) — когда выручка станет заметной.
- **PFA в Румынии** — нужен sediu в RO, налоги 10% + CASS + CAS; при проживании в MD налоговое резидентство, скорее
  всего, MD (конвенция MD–RO 1995). Только если реально жить/работать в RO.
- **Estonia e-Residency** — ~€1 300–2 000 за первый год; на потом.

## 5. Источники

- Paddle: https://www.paddle.com/help/start/account-verification/what-is-business-verification · https://www.paddle.com/help/start/account-verification/what-is-identity-verification · https://www.paddle.com/help/legal/sanctions · https://www.paddle.com/help/manage/get-paid/is-there-a-fee-taken-for-payouts · https://www.paddle.com/pricing · https://supportedcountries.com/paddle/ · https://dev.to/odedunipaas/paddle-rejected-my-account-heres-the-map-of-what-actually-works-in-2026-1f1k · https://dev.to/pavelbuild/paddle-rejected-my-saas-3-times-heres-what-they-check-that-isnt-in-their-docs-5dnn
- Lemon Squeezy: https://docs.lemonsqueezy.com/help/getting-started/supported-countries · https://docs.lemonsqueezy.com/help/getting-started/getting-paid · https://docs.lemonsqueezy.com/help/getting-started/verify-your-identity · https://www.lemonsqueezy.com/blog/2026-update · https://www.trustpilot.com/review/lemonsqueezy.com
- Polar / Stripe: https://polar.sh/docs/merchant-of-record/supported-countries · https://polar.sh/docs/features/finance/accounts · https://docs.stripe.com/changelog/clover/2026-02-25/cross-border-payouts-new-countries.md · https://docs.stripe.com/connect/cross-border-payouts · https://stripe.com/en-ro/legal/ssa/ro · https://support.stripe.com/questions/requirements-to-open-a-stripe-account-in-another-country · https://dodopayments.com/blogs/polar-sh-review · https://dodopayments.com/blogs/stripe-managed-payments-fees-explained
- Creem: https://docs.creem.io/merchant-of-record/supported-countries · https://www.creem.io/pricing · https://www.trustpilot.com/review/creem.io
- Dodo: https://docs.dodopayments.com/miscellaneous/accepted-countries-and-territories · https://dodopayments.com/pricing · https://docs.dodopayments.com/features/payouts/payout-structure · https://www.trustpilot.com/review/dodopayments.com
- Gumroad / FastSpring / 2Checkout / Payhip / Freemius: https://x.com/gumroad/status/1856525514275803638 · https://gumroad.com/help/article/13-getting-paid · https://checkoutpage.com/blog/gumroad-fees · https://developer.fastspring.com/docs/fastspring-payouts-portal · https://www.vendr.com/buyer-guides/fastspring · https://verifone.cloud/docs/2checkout/Onboarding/Payouts · https://www.trustradius.com/products/verifone-2checkout/pricing · https://help.payhip.com/article/65-connecting-your-stripe-account · https://freemius.com/help/documentation/selling-with-freemius/supported-countries/ · https://freemius.com/help/payout-methods/ · https://freemius.com/pricing/
- PayPal MD: https://www.paypal.com/md/webapps/mpp/paypal-fees · https://www.doola.com/paypal-guide/how-to-open-a-paypal-account-in-moldova/ · https://consecon.gov.md/en/2025/04/29/moldovan-businesses-to-gain-easier-access-to-stripe-paypal-and-revolut-government-removes-barriers-to-international-payments-and-ecommerce/
- Revolut: https://help.revolut.com/en-RO/business/help/account-management-plans-and-billings/billings-and-allowances/changes-to-our-freelancer-plans/ · https://www.revolut.com/en-RO/legal/pro/ · https://www.finder.com/uk/business-banking/revolut-pro-review · https://www.romania-insider.com/revolut-pro-launch-romania-2022
- Молдова, налоги: https://mded.gov.md/legea-freelancerilor-a-intrat-in-vigoare-inregistrare-online-taxe-simple-si-protectie-sociala/ · https://mded.gov.md/cinci-pasi-simpli-pentru-a-beneficia-de-regimul-fiscal-de-antreprenor-independent-freelancer/ · https://www.contabilsef.md/regimul-fiscal-al-antreprenorilor-independenti · https://contabilitate.md/ro/news/2796 · https://cor.md/freelancerguide · https://cnas.gov.md/en/node/576 · https://bancamea.md/news/ce-trebuie-sa-stii-despre-plata-impozitului-daca-esti-freelancer/ · https://bancamea.md/news/640-de-moldoveni-amendati-in-mai-pentru-afaceri-nedeclarate-ce-risca-cei-care-vand-online-sau-lucreaza-la-negru · https://www.contabilsef.md/amenzi-conform-codului-contraventional · https://declaratie-rapida.fisc.md/Document.aspx?taxid=CET18 · https://ducont.md/en/blog/article/freelancer/
- Румыния / Эстония: https://startco.ro/blog/infiintare-pfa-cetatean-strain/ · https://contapp.ro/blog/taxe-pfa-2026/ · https://storno.ro/ghid/taxe-pfa-2026 · https://mf.gov.md/sites/default/files/Romania_rom.pdf · https://legislatie.just.ro/Public/DetaliiDocumentAfis/35174 · https://corpsec.io/jurisdiction/estonia/guides/cost · https://capture.ee/cost-of-company-formation-in-estonia/
- Payout-рельсы: https://www.alexontrading.com/faq/availability/ewallets/transferwise-moldova · https://vaultleap.com/blog/payoneer-withdrawal-conversion-fees-2026
