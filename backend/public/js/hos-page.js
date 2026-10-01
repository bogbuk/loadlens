/* Страница HOS-калькулятора: форма → LLHOSTRIP (js/hos-trip.js) → остатки и план рейса.
   Строки интерфейса — JSON #ll-strings, его вписывает build-landing для каждого языка.
   Всё считается в браузере, ничего не отправляется. */
(function () {
  "use strict";
  const S = JSON.parse(document.getElementById("ll-strings").textContent);
  const $ = (id) => document.getElementById(id);
  const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (_, k) => (k in v ? v[k] : ""));
  const num = (id) => { const n = parseFloat($(id).value); return Number.isFinite(n) && n > 0 ? n : 0; };
  const hm = (name) => num(name + "-h") * 60 + num(name + "-m");
  // Оба поля пустые → null: модуль считает, что перерыва в смене не было.
  const hmOrEmpty = (name) => ($(name + "-h").value === "" && $(name + "-m").value === "" ? null : hm(name));
  const fmt = (min) => { const t = Math.max(0, Math.round(min)); return fill(S["js.hm"], { h: Math.floor(t / 60), m: t % 60 }); };

  // Галка «по дням» → days (часы, пустое = 0), иначе одна сумма цикла. Для 60/7 седьмой день назад не нужен.
  function readState() {
    const cycle = document.querySelector('input[name="cycle"]:checked').value;
    const st = { cycle, drivenMin: hm("driven"), shiftMin: hm("shift"), sinceBreakMin: hmOrEmpty("since"), cycleUsedMin: hm("used") };
    if ($("byday").checked) st.days = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => Math.round(num("d" + i) * 60));
    return st;
  }

  // Галка split выключена → null. Первый отдых входит в «Прошло с начала смены» (подсказка в форме).
  function readSplit() {
    if (!$("split").checked) return null;
    return {
      firstMin: hm("first"), firstSleeper: document.querySelector('input[name="first-type"]:checked').value === "sb",
      drivenAfterMin: hm("after"), sinceMin: hm("aftert"),
    };
  }

  function renderRemaining(state, r, pair) {
    const full = { ...LLHOSTRIP.LIMITS, cycle: LLHOSTRIP.CYCLES[LLHOSTRIP.normalize(state).cycle] };
    for (const k of ["drive", "window", "break", "cycle"]) {
      const row = document.querySelector(`.meter[data-k="${k}"]`);
      row.querySelector(".fill").style.width = ((100 * r[k]) / full[k]).toFixed(1) + "%";
      row.querySelector(".val").textContent = fill(S["js.left"], { t: fmt(r[k]) });
      row.classList.toggle("first", k === r.limitedBy);
    }
    // В паре 11h/14h лечит не 10h reset, а второй отдых split.
    const inPair = pair && pair.ok && (r.limitedBy === "drive" || r.limitedBy === "window");
    // Часы по дням и старейший день не пуст → цикл лечит полночь, а не 34h restart.
    const recapNext = r.limitedBy === "cycle" && r.recapMin > 0;
    const next = inPair ? S["js.next.split"] : recapNext ? S["js.next.recap"] : {
      break: S["js.next.break"], drive: S["js.next.drive"], window: S["js.next.window"], cycle: S["js.next.cycle"],
    }[r.limitedBy];
    $("now").textContent = fill(S["js.now"], { t: fmt(r.driveNow), next });
    $("recap-msg").hidden = r.recapMin == null;
    if (r.recapMin != null) {
      $("recap-msg").textContent = fill(S["js.recap"], { t: fmt(r.recapMin), n: LLHOSTRIP.normalize(state).days.length - 1 });
    }
  }

  function renderSplit(pair) {
    $("split-box").hidden = !pair;
    if (!pair) return;
    $("split-cond").hidden = !pair.ok;
    $("split-msg").textContent = !pair.ok ? S["js.split." + pair.reason] : [
      fill(S["js.split.need"], { t: fmt(pair.secondMin), where: S[pair.secondSleeper ? "js.split.where.sb" : "js.split.where.any"] }),
      fill(S["js.split.after"], { d: fmt(pair.after.driveNow), w: fmt(pair.after.window) }),
    ].join(" ");
  }

  const SEG = {
    duty: S["js.seg.duty"], drive: S["js.seg.drive"], break: S["js.seg.break"],
    reset: S["js.seg.reset"], restart: S["js.seg.restart"], recap: S["js.seg.recap"],
  };

  function renderPlan(state) {
    const miles = num("miles");
    $("plan-box").hidden = !miles;
    $("plan-hint").hidden = !!miles;
    if (!miles) return;
    // Пустое поле погрузки = 0 (пользователь стёр), пустая скорость = дефолт модуля (55).
    const start = new Date();
    const p = LLHOSTRIP.plan(state, {
      miles, mph: $("mph").value, loadMin: num("load"), unloadMin: num("unload"),
      clockMin: start.getHours() * 60 + start.getMinutes(),
    });
    const list = $("plan");
    list.textContent = "";
    for (const s of p.segments) {
      const li = document.createElement("li");
      li.className = s.type;
      const name = document.createElement("span");
      name.textContent = fill(SEG[s.type], { mi: s.miles || 0 });
      const t = document.createElement("b");
      t.textContent = fmt(s.min);
      li.append(name, t);
      list.append(li);
    }
    $("total").textContent = fill(S["js.total"], { t: fmt(p.totalMin), d: fmt(p.driveMin), r: fmt(p.restMin) });
    const when = new Date(start.getTime() + p.totalMin * 60000)
      .toLocaleString(document.documentElement.lang, { weekday: "short", hour: "2-digit", minute: "2-digit" });
    $("arrive").textContent = fill(S["js.arrive"], { when });
    // С часами по дням recap уже посчитан — оговорка про «может хватить меньшего» не нужна.
    $("restart-note").hidden = !p.restarts || !!state.days;
  }

  function update() {
    const st = readState();
    const sp = readSplit();
    $("split-fields").hidden = !sp;
    $("days-fields").hidden = !st.days;
    $("used-field").hidden = !!st.days;
    document.querySelector(".day.d7").hidden = st.cycle !== "70-8";
    const pair = sp && LLHOSTRIP.splitPair(st, sp);
    renderRemaining(st, pair ? pair.now : LLHOSTRIP.remaining(st), pair);
    renderSplit(pair);
    // План ставит полные 10h reset; первый отдых пары только выводим из окна 14h.
    renderPlan(pair ? pair.state : st);
  }

  $("calc").addEventListener("input", update);
  update();
})();
