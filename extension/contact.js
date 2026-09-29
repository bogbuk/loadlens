/* LoadLens — куда пользователю писать (Get Pro, вопросы, поддержка облака).
   Один адрес на всё расширение: сменить почту = поправить EMAIL здесь.
   Pro выдаётся вручную (Stripe нет), поэтому просьба о Pro — это письмо с email аккаунта в теме. */
const LLCONTACT = (() => {
  const EMAIL = "hello@krait.studio";

  // topic: "pro" | "cloud" | "question"; account — email аккаунта LoadLens (если вошёл)
  function mailto(topic, account) {
    const subjects = { pro: "LoadLens Pro request", cloud: "LoadLens Cloud support", question: "LoadLens question" };
    const subject = (subjects[topic] || subjects.question) + (account ? " — " + account : "");
    const body = topic === "pro"
      ? "Hi, I'd like to upgrade to LoadLens Pro.\n\nLoadLens account: " + (account || "(not signed up yet)") + "\nDrivers / trucks: \n"
      : "LoadLens account: " + (account || "(not signed in)") + "\n\n";
    return "mailto:" + EMAIL + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  }

  return { EMAIL, mailto };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLCONTACT; }
if (typeof globalThis !== "undefined") globalThis.LLCONTACT = LLCONTACT;
