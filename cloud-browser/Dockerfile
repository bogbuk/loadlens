# Прод-образ LoadLens Cloud: Chromium + Xvfb + x11vnc + noVNC + распакованное расширение LoadLens.
# Контекст сборки — корень репозитория (нужен каталог extension/). Собирается GitHub Actions → GHCR.
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium xvfb x11vnc novnc websockify supervisor \
      fonts-liberation fonts-noto-color-emoji ca-certificates procps curl \
    && rm -rf /var/lib/apt/lists/*

# Расширение из того же коммита + постоянный профиль Chromium (volume /data)
COPY extension/ /ext/
RUN useradd -m -u 1000 browser && mkdir -p /data /var/log/supervisor \
    && chown -R browser:browser /data /ext

COPY cloud-browser/supervisord.conf /etc/supervisor/conf.d/browser.conf
COPY cloud-browser/start-chromium.sh /usr/local/bin/start-chromium.sh
RUN chmod +x /usr/local/bin/start-chromium.sh

ENV DISPLAY=:99 \
    SCREEN=1440x900x24 \
    START_URL=https://one.dat.com/search-loads \
    NOVNC_PASSWORD=changeme \
    LL_INSTANCE_ID= \
    CHROMIUM_RECYCLE_HOURS=12

EXPOSE 6080
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:6080/vnc.html >/dev/null || exit 1
CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
