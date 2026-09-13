#!/bin/sh
# Ждём X-сервер, пишем cloud-конфиг расширения, снимаем чужой SingletonLock, стартуем Chromium.
for i in $(seq 1 50); do [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ] && break; sleep 0.2; done

# Пароль VNC обязателен и не имеет дефолта: экран висит на публичном домене Traefik и показывает
# живую сессию DAT. Пустой (или общеизвестный changeme) пароль = чужой доступ к аккаунту клиента,
# поэтому контейнер обязан падать громко, а не отдавать незащищённый экран.
if [ -z "$NOVNC_PASSWORD" ] || [ "$NOVNC_PASSWORD" = "changeme" ]; then
  echo "refusing to start: NOVNC_PASSWORD is not set" >&2
  exit 1
fi

# Cloud mode расширения: content.js/popup читают globalThis.LL_CLOUD из cloud.config.js.
# Без LL_INSTANCE_ID файл остаётся заглушкой из репо — обычный режим (удобно для локального smoke).
if [ -n "$LL_INSTANCE_ID" ]; then
  printf 'globalThis.LL_CLOUD = { mode: true, instanceId: "%s" };\n' "$LL_INSTANCE_ID" > /ext/cloud.config.js
fi

# Профиль лежит в volume: после пересоздания контейнера остаётся чужой SingletonLock, и Chromium
# показывает диалог «profile in use on another computer». hostname у нас фиксирован, lock — страховка.
rm -f /data/profile/SingletonLock /data/profile/SingletonSocket /data/profile/SingletonCookie
WH=$(echo "$SCREEN" | cut -d x -f1,2 | tr x ,)
exec /usr/bin/chromium \
  --user-data-dir=/data/profile \
  --load-extension=/ext \
  --disable-extensions-except=/ext \
  --no-sandbox --no-first-run --no-default-browser-check \
  --disable-dev-shm-usage --disable-gpu \
  --password-store=basic \
  --window-position=0,0 --window-size="$WH" \
  --disable-features=TranslateUI \
  --lang=en-US \
  "$START_URL"
