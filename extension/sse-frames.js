/* LoadLens — чистый парсер кадров SSE (Server-Sent Events), zero-dep, без DOM.
   Нужен inject.js (MAIN world), чтобы разобрать поток DAT Load Match Alerts
   (`notification/v3/liveQueryMatches/{searchId}`, text/event-stream), который приложение DAT
   само открыло в сессии пользователя. Мы поток НЕ инициируем — только читаем клон ответа.
   Формат по спецификации WHATWG: строки `field:value`, кадры разделены пустой строкой,
   `:` в начале — комментарий (у DAT это `:Keep-Alive` раз в 10 с), `retry:` — интервал реконнекта.
   push(chunk) принимает произвольно порезанный текст и отдаёт только ЗАВЕРШЁННЫЕ кадры с data. */
const LLSSE = (() => {
  "use strict";

  function createParser() {
    let buf = "";
    // Один кадр (без завершающей пустой строки) → {id, event, data} | null (нет data).
    function parseFrame(text) {
      let id = null, event = null; const data = [];
      for (const raw of text.split("\n")) {
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        if (!line || line[0] === ":") continue;                    // пусто / комментарий
        const i = line.indexOf(":");
        const field = i === -1 ? line : line.slice(0, i);
        let value = i === -1 ? "" : line.slice(i + 1);
        if (value[0] === " ") value = value.slice(1);
        if (field === "data") data.push(value);
        else if (field === "event") event = value;
        else if (field === "id") id = value;
        // retry и неизвестные поля игнорируем
      }
      if (!data.length) return null;
      return { id, event: event || "message", data: data.join("\n") };
    }

    // push(chunk) → events[]: копит хвост незавершённого кадра между вызовами.
    function push(chunk) {
      buf += String(chunk == null ? "" : chunk);
      const out = [];
      for (;;) {
        // граница кадра: пустая строка (\n\n или \r\n\r\n)
        const m = /\r?\n\r?\n/.exec(buf);
        if (!m) break;
        const frame = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        const ev = parseFrame(frame);
        if (ev) out.push(ev);
      }
      return out;
    }

    return { push };
  }

  return { createParser };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LLSSE;
if (typeof globalThis !== "undefined") globalThis.LLSSE = LLSSE;
