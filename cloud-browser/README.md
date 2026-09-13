# cloud-browser

Прод-образ LoadLens Cloud: Chromium (без sandbox, uid 1000) + Xvfb + x11vnc + noVNC + supervisor +
распакованное расширение `extension/` из того же коммита. Экран — по HTTP на порту 6080 (`/vnc.html`).
Профиль Chromium (сессия DAT) — в volume `/data`, переживает пересоздание контейнера.

| env | назначение | дефолт |
|---|---|---|
| `LL_INSTANCE_ID` | id тенанта → пишется в `/ext/cloud.config.js` (cloud mode расширения) | пусто (обычный режим) |
| `NOVNC_PASSWORD` | пароль VNC-экрана (генерит бэкенд) | обязателен, дефолта нет; контейнер не стартует, если пусто или `changeme` |
| `START_URL` | стартовый URL Chromium | `https://one.dat.com/search-loads` |
| `SCREEN` | геометрия Xvfb/окна | `1440x900x24` |
| `CHROMIUM_RECYCLE_HOURS` | период рестарта Chromium (лечит рост RAM) | `12` |

## Локальный smoke

```bash
docker build -f cloud-browser/Dockerfile -t loadlens-cloud-browser:dev .
docker run -d --name llc-smoke -p 6080:6080 -e LL_INSTANCE_ID=test-1 -e NOVNC_PASSWORD=<your-password> \
  --shm-size 512m -m 2g loadlens-cloud-browser:dev
# http://localhost:6080/vnc.html?autoconnect=1&resize=scale&password=<your-password>
docker exec llc-smoke cat /ext/cloud.config.js     # → globalThis.LL_CLOUD = { mode: true, instanceId: "test-1" };
docker exec llc-smoke supervisorctl -c /etc/supervisor/supervisord.conf status  # 5 программ RUNNING
docker rm -f llc-smoke
```

**`?password=` в URL:** подключение без интерактивного клиента не проверено (нет headless VNC-клиента в
этой среде), но проверено по исходникам установленного пакета `novnc 1.3.0-1`: `autoconnect=1` вызывает
`UI.connect()`, которая берёт `password` из query через `WebUtil.getConfigVar` (`app/ui.js`, `app/webutil.js`) —
диалога с паролем не будет, ссылка из §5 спеки подключит экран сразу.
