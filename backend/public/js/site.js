/* Общий скрипт страниц сайта: запоминание языка, согласие на аналитику (GDPR), Яндекс Метрика и Google Analytics только после Accept, цель install_click. Подключается в конце <body>. */
/* Выбор языка в шапке запоминаем: иначе EN-страница снова увела бы на язык браузера. */
for (const a of document.querySelectorAll("[data-lang]")) {
  a.addEventListener("click", () => { try { localStorage.setItem("ll_lang", a.dataset.lang); } catch (e) {} });
}

/* Согласие на аналитику (GDPR): Яндекс Метрика и Google Analytics грузятся ТОЛЬКО после Accept. Выбор — localStorage
   ll_consent = granted | denied; нет выбора → баннер. «Cookie settings» в футере открывает его снова. */
(function () {
  const KEY = "ll_consent";
  const banner = document.getElementById("consent");
  const get = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const set = (v) => { try { localStorage.setItem(KEY, v); } catch (e) {} };
  let loaded = false;

  function loadMetrika() {
    if (loaded) return;
    loaded = true;
    (function(m,e,t,r,i,k,a){
        m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
        m[i].l=1*new Date();
        for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
        k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
    })(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id=113205805', 'ym');
    ym(113205805, 'init', {ssr:true, webvisor:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});

    // Google Analytics 4. dataLayer общий с ecommerce Метрики — так и задумано, Метрика читает только ecommerce-объекты.
    const g = document.createElement("script");
    g.async = true;
    g.src = "https://www.googletagmanager.com/gtag/js?id=G-0JGJW592YL";
    document.head.appendChild(g);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    // Consent mode (basic): тег грузится только после Accept, поэтому аналитика granted; рекламы нет — ads denied.
    gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    gtag('js', new Date());
    gtag('config', 'G-0JGJW592YL');
  }

  document.getElementById("ck-yes").addEventListener("click", () => { set("granted"); banner.hidden = true; loadMetrika(); });
  document.getElementById("ck-no").addEventListener("click", () => { set("denied"); banner.hidden = true; });
  document.getElementById("ck-open").addEventListener("click", (e) => { e.preventDefault(); banner.hidden = false; });

  // Цель install_click (Метрика → Цели → JavaScript-событие) с местом кнопки и языком страницы.
  // То же событие уходит в GA4. Без согласия ym/gtag не загружены — вызовы пропускаем, ничего не отправляется.
  for (const a of document.querySelectorAll("[data-cws]")) {
    a.addEventListener("click", () => {
      if (typeof window.ym === "function")
        window.ym(113205805, 'reachGoal', 'install_click', { place: a.dataset.cws, lang: document.documentElement.lang });
      if (typeof window.gtag === "function")
        window.gtag('event', 'install_click', { place: a.dataset.cws, lang: document.documentElement.lang });
    });
  }

  const choice = get();
  if (choice === "granted") loadMetrika();
  else if (choice !== "denied") banner.hidden = false;
})();
