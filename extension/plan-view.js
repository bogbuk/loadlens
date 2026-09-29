/* LoadLens — что показать про план в Settings (бейдж + заметка). Чистая функция, без DOM.
   План из кэша может отставать от часов: истёкший по trialEndsAt триал показываем как закончившийся. */
const LLPLANVIEW = (() => {
  const DAY = 86400000;

  function view(user, now) {
    const end = user && user.trialEndsAt != null ? Number(user.trialEndsAt) : null;
    if (end != null && end > now && user.plan === "pro")
      return { badge: "PRO TRIAL", pro: true, note: "trial", daysLeft: Math.ceil((end - now) / DAY) };
    if (end != null && end <= now) return { badge: "FREE", pro: false, note: "ended", daysLeft: null };
    if (user && user.plan === "pro") return { badge: "PRO", pro: true, note: null, daysLeft: null };
    return { badge: "FREE", pro: false, note: "upsell", daysLeft: null };
  }

  return { view };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLPLANVIEW; }
if (typeof globalThis !== "undefined") globalThis.LLPLANVIEW = LLPLANVIEW;
