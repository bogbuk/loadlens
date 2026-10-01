/* LoadLens — что показать про план в Settings (бейдж + заметка). Чистая функция, без DOM.
   План из кэша может отставать от часов: истёкший по trialEndsAt триал показываем как закончившийся. */
const LLPLANVIEW = (() => {
  const DAY = 86400000;

  const LIVE = ["active", "trialing", "past_due", "paused"];
  const day = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  // action: upgrade — кнопка оплаты; manage — портал Paddle; contact — прежние mailto-ссылки.
  // Оплату показываем только при user.billing (сервер решает по BILLING_MODE): до запуска её не видит никто.
  function billingAction(user, base) {
    const sub = user && user.subscription;
    const live = !!(sub && LIVE.includes(sub.status));
    if (!user || !user.billing) return { action: "contact", subLine: null };
    if (live) {
      const subLine = sub.status === "past_due" ? "Payment failed — update your card"
        : sub.endsAt ? "Ends on " + day(Number(sub.endsAt))
        : sub.renewsAt ? "Renews on " + day(Number(sub.renewsAt)) : null;
      return { action: "manage", subLine };
    }
    // Постоянный Pro, выданный руками, оплачивать нечего.
    if (base.pro && base.note === null) return { action: "contact", subLine: null };
    return { action: "upgrade", subLine: null };
  }

  function view(user, now) {
    const end = user && user.trialEndsAt != null ? Number(user.trialEndsAt) : null;
    let base;
    if (end != null && end > now && user.plan === "pro")
      base = { badge: "PRO TRIAL", pro: true, note: "trial", daysLeft: Math.ceil((end - now) / DAY) };
    else if (end != null && end <= now) base = { badge: "FREE", pro: false, note: "ended", daysLeft: null };
    else if (user && user.plan === "pro") base = { badge: "PRO", pro: true, note: null, daysLeft: null };
    else base = { badge: "FREE", pro: false, note: "upsell", daysLeft: null };
    return { ...base, ...billingAction(user, base) };
  }

  return { view };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLPLANVIEW; }
if (typeof globalThis !== "undefined") globalThis.LLPLANVIEW = LLPLANVIEW;
