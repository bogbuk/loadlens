# Публикация расширения в Chrome Web Store

## Почему не через дашборд

Chrome **запрещает расширениям скриптовать домен магазина** (`The extensions gallery cannot be
scripted`), поэтому браузерная автоматизация дашборда невозможна в принципе — ни у нас, ни у кого.
Зато есть официальный **Chrome Web Store API**: `scripts/publish-ext.js` заливает пакет и отправляет
его на ревью без единого клика.

Единственное, что должен сделать человек — разовая OAuth-авторизация (шаг 1–4 ниже): логин в свой
Google-аккаунт за владельца сделать нельзя. Дальше каждый релиз — одна команда.

## Разовая настройка (~5 минут)

1. **Google Cloud Console** → создать проект (или взять существующий) → **APIs & Services → Library**
   → включить **Chrome Web Store API**.
2. **OAuth consent screen**: тип *External*, приложение можно оставить в статусе *Testing*, себя
   добавить в *Test users* (иначе refresh-токен протухнет через 7 дней).
3. **Credentials → Create credentials → OAuth client ID → Application type: Desktop app** →
   скопировать `Client ID` и `Client secret`.
4. Положить в `.local_dev.env` в корне репозитория (файл в `.gitignore`, секреты не коммитим):

   ```
   CWS_EXTENSION_ID=<id айтема из адреса дашборда>
   CWS_CLIENT_ID=<...>.apps.googleusercontent.com
   CWS_CLIENT_SECRET=<...>
   ```

   Затем получить refresh-токен:

   ```bash
   npm run publish:ext -- --auth-url        # печатает ссылку согласия — открыть в браузере
   # согласиться; страница http://localhost не откроется — это нормально,
   # нужен параметр ?code=... из адресной строки
   npm run publish:ext -- --exchange "<code>"
   ```

   Команда напечатает строку `CWS_REFRESH_TOKEN=...` — дописать её в тот же `.local_dev.env`.

## Релиз

```bash
npm test && npm run package:ext          # собрать пакет под версию из manifest.json
npm run publish:ext -- --status          # что сейчас в черновике/магазине
npm run publish:ext                      # залить пакет в ЧЕРНОВИК (на ревью не отправляет)
npm run publish:ext -- --publish         # залить и отправить на ревью
```

Скрипт сам берёт `dist/loadlens-extension-<версия манифеста>.zip` и падает с внятной ошибкой, если
пакет под текущую версию не собран.

## Грабли

- **Черновик на ревью блокирует новую подачу.** Если предыдущая версия висит *Pending review*,
  залить поверх можно, а вот `--publish` вернёт ошибку — сначала отозвать подачу (в дашборде
  *Roll back to draft*).
- **Токен из аккаунта-владельца.** API работает от того Google-аккаунта, который владеет айтемом;
  у аккаунта-участника группы публикации прав на `publish` может не быть.
- **Смена разрешений в манифесте** → ревью дольше и попросит обоснования в дашборде. Сверять до
  подачи: `permissions` / `host_permissions` / `content_scripts.matches` против опубликованной версии.
- **Статус *Testing* у OAuth-приложения** даёт refresh-токен на 7 дней. Для постоянного —
  опубликовать consent screen (*Publish app*), либо просто переполучать токен шагом 4.
