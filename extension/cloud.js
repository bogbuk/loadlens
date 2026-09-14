/* LoadLens cloud mode (LLCLOUD): чистые функции без DOM/сети — тестируются node --test.
   Конфиг приходит из globalThis.LL_CLOUD (cloud.config.js, который пишет контейнер).
   Метки FindLoads/heartbeat живут в sessionStorage: авто-пилот перезагружает вкладку каждые
   60–120 с, поэтому таймеры в памяти не доживают до 5 минут. */
const LLCLOUD = (() => {
  "use strict";
  const HEARTBEAT_MS = 5 * 60 * 1000;   // период heartbeat
  const STALE_INTERVALS = 3;            // FindLoads не было дольше N интервалов авто-пилота → stale
  const K_LFL = "ll_cloud_lfl_at";      // ts последнего FindLoads
  const K_HB = "ll_cloud_hb_at";        // ts последнего отправленного heartbeat
  const K_HB_STATE = "ll_cloud_hb_state";

  function config(g) {
    const c = g && g.LL_CLOUD;
    if (!c || c.mode !== true || typeof c.instanceId !== "string" || !c.instanceId) return null;
    return { instanceId: c.instanceId };
  }
  function clientIdFor(cfg, localId) { return cfg ? `cloud:${cfg.instanceId}` : localId; }

  function detectState({ hostname, lastFindLoadsAt, now, intervalMs }) {
    if (/^login\./i.test(String(hostname || ""))) return "logged_out";
    const iv = Math.max(60000, Number(intervalMs) || 60000);
    if (!lastFindLoadsAt || now - lastFindLoadsAt > STALE_INTERVALS * iv) return "stale";
    return "ok";
  }
  function heartbeat({ hostname, lastFindLoadsAt, now, intervalMs, loadsSeen }) {
    return {
      state: detectState({ hostname, lastFindLoadsAt, now, intervalMs }),
      loadsSeen: Math.max(0, Math.floor(Number(loadsSeen) || 0)),
      lastFindLoadsAt: lastFindLoadsAt || null,
    };
  }

  function readNum(ss, k) { try { const v = ss ? ss.getItem(k) : null; const n = Number(v); return v && n > 0 ? n : null; } catch (_) { return null; } }
  function write(ss, k, v) { try { if (ss) ss.setItem(k, String(v)); } catch (_) { /* приватный режим/квота */ } }
  function readStr(ss, k) { try { return ss ? ss.getItem(k) : null; } catch (_) { return null; } }

  const markFindLoads = (ss, now) => write(ss, K_LFL, now);
  const lastFindLoads = (ss) => readNum(ss, K_LFL);
  function markHeartbeat(ss, now, state) { write(ss, K_HB, now); write(ss, K_HB_STATE, state); }
  function due(ss, now, state) {
    const last = readNum(ss, K_HB);
    if (!last) return true;
    if (readStr(ss, K_HB_STATE) !== state) return true;
    return now - last >= HEARTBEAT_MS;
  }

  // Один тик: если пора — шлём; метку ставим ТОЛЬКО после подтверждённой отправки (send → true).
  // Иначе следующий тик (через минуту) повторит попытку — без JWT/сети heartbeat не «сгорает» на 5 мин.
  async function tickHeartbeat({ ss, now, hb, send }) {
    if (!due(ss, now, hb.state)) return "skipped";
    let ok = false;
    try { ok = (await send(hb)) === true; } catch (_) { ok = false; }
    if (!ok) return "failed";
    markHeartbeat(ss, now, hb.state);
    return "sent";
  }

  return { HEARTBEAT_MS, STALE_INTERVALS, config, clientIdFor, detectState, heartbeat,
           markFindLoads, lastFindLoads, markHeartbeat, due, tickHeartbeat };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = LLCLOUD; }
if (typeof globalThis !== "undefined") globalThis.LLCLOUD = LLCLOUD;
