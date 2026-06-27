# Forgot-Password (Telegram) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сброс забытого пароля: `POST /auth/forgot` шлёт короткий код в Telegram-бот, `POST /auth/reset` меняет пароль по коду; в попапе — поток «Забыл пароль?».

**Architecture:** Бэкенд NestJS: +2 колонки в `User` (sha256-хеш кода + expiry), `AuthService.forgot/reset` (инжектит `TelegramService` для доставки), эндпоинты в `AuthController` под Throttle. Telegram — публичная обёртка `sendMessageTo` над protected `send`, `TelegramModule` экспортит сервис, `AuthModule` его импортит (цикла нет). Фронт — vanilla попап (`api.js` + `popup.js`).

**Tech Stack:** NestJS 10, Sequelize (Postgres, `synchronize:true`), `@nestjs/jwt`, `@nestjs/throttler`, class-validator, bcryptjs, Node `crypto`, Jest. Расширение — vanilla JS, тесты `node --test`.

## Global Constraints

- Бэкенд под `/api/v1` (глобальный префикс), `ValidationPipe({ whitelist:true, transform:true })` — DTO обязательны.
- Новые колонки — только идемпотентный `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` в `main.ts`.
- PII: `passwordHash`/reset-поля наружу НЕ отдаются. Ответ `forgot` — всегда `{ ok: true }` (без enumeration).
- Email нормализуется `trim().toLowerCase()`.
- Код сброса в БД — только как **sha256** (плейн не храним). TTL 30 мин, одноразовый.
- Все строки в коде/ответах/комментариях — на русском.
- Коммиты — БЕЗ упоминаний AI/Claude (без Co-Authored-By).
- Бэкенд-тесты: `cd backend && npm test`. Extension-тесты: `npm test` (корень, `node --test`).

---

### Task 1: Хелперы кода сброса + колонки в модели + ALTER

**Files:**
- Create: `backend/src/auth/reset-code.ts`
- Test: `backend/src/auth/reset-code.spec.ts`
- Modify: `backend/src/users/user.model.ts`
- Modify: `backend/src/main.ts`

**Interfaces:**
- Produces: `genResetCode(): string` — 8 символов из алфавита `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.
- Produces: `sha256(input: string): string` — hex sha256.
- Produces (model): `User.passwordResetTokenHash: string | null`, `User.passwordResetExpires: number | null`.

- [ ] **Step 1: Написать падающий тест хелперов**

Create `backend/src/auth/reset-code.spec.ts`:
```typescript
import { genResetCode, sha256 } from './reset-code';

describe('reset-code', () => {
  it('genResetCode: 8 символов только из безопасного алфавита', () => {
    for (let i = 0; i < 30; i++) {
      const code = genResetCode();
      expect(code).toHaveLength(8);
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    }
  });

  it('sha256: детерминирован, hex 64 символа, разный для разных входов', () => {
    expect(sha256('CODE1234')).toBe(sha256('CODE1234'));
    expect(sha256('CODE1234')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256('CODE1234')).not.toBe(sha256('CODE1235'));
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cd backend && npx jest reset-code`
Expected: FAIL — `Cannot find module './reset-code'`.

- [ ] **Step 3: Реализовать хелперы**

Create `backend/src/auth/reset-code.ts`:
```typescript
import { createHash, randomInt } from 'crypto';

// Алфавит без визуально неоднозначных символов (0/O, 1/I/L) — код вводят руками из Telegram.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function genResetCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
```

- [ ] **Step 4: Запустить — зелёный**

Run: `cd backend && npx jest reset-code`
Expected: PASS (2 теста).

- [ ] **Step 5: Добавить колонки в модель**

Modify `backend/src/users/user.model.ts` — добавить после поля `alertsEnabled` (перед закрывающей `}` класса):
```typescript
  // Сброс пароля: sha256 одноразового кода (не плейн) + epoch ms истечения (TTL 30 мин).
  @Column({ type: DataType.TEXT, allowNull: true, field: 'password_reset_token_hash' })
  passwordResetTokenHash: string | null;

  @Column({ type: DataType.BIGINT, allowNull: true, field: 'password_reset_expires' })
  passwordResetExpires: number | null;
```

- [ ] **Step 6: Идемпотентные ALTER в `main.ts`**

Modify `backend/src/main.ts` — после блока ALTER для `role`/`blocked` добавить:
```typescript
  await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT');
  await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires BIGINT');
```

- [ ] **Step 7: Собрать и прогнать тесты**

Run: `cd backend && npm run build && npm test`
Expected: build OK, все тесты PASS (включая новые reset-code).

- [ ] **Step 8: Commit**

```bash
git add backend/src/auth/reset-code.ts backend/src/auth/reset-code.spec.ts backend/src/users/user.model.ts backend/src/main.ts
git commit -m "feat(auth): хелперы кода сброса (genResetCode/sha256) + колонки password_reset_* + ALTER"
```

---

### Task 2: `TelegramService.sendMessageTo` + экспорт сервиса

**Files:**
- Modify: `backend/src/telegram/telegram.service.ts`
- Modify: `backend/src/telegram/telegram.module.ts`
- Test: `backend/src/telegram/telegram.service.spec.ts`

**Interfaces:**
- Consumes: protected `send(chatId, text): Promise<boolean>` (уже есть).
- Produces: `TelegramService.sendMessageTo(chatId: string, text: string): Promise<boolean>` (public, делегирует в `send`); `TelegramModule` экспортит `TelegramService`.

- [ ] **Step 1: Написать падающий тест делегирования**

Modify `backend/src/telegram/telegram.service.spec.ts` — добавить в конец файла:
```typescript
describe('TelegramService.sendMessageTo', () => {
  class TestTg extends TelegramService {
    sent: Array<{ chatId: string; text: string }> = [];
    protected async send(chatId: string, text: string): Promise<boolean> {
      this.sent.push({ chatId, text });
      return true;
    }
  }

  it('делегирует в protected send и возвращает его результат', async () => {
    const tg = new TestTg({} as any, {} as any);
    const ok = await tg.sendMessageTo('chat-1', 'привет');
    expect(ok).toBe(true);
    expect(tg.sent).toEqual([{ chatId: 'chat-1', text: 'привет' }]);
  });
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `cd backend && npx jest telegram.service`
Expected: FAIL — `sendMessageTo is not a function`.

- [ ] **Step 3: Добавить публичную обёртку**

Modify `backend/src/telegram/telegram.service.ts` — добавить метод прямо перед `protected async send(`:
```typescript
  // Публичная обёртка над низкоуровневой отправкой (для DM из других сервисов, напр. код сброса пароля).
  async sendMessageTo(chatId: string, text: string): Promise<boolean> {
    return this.send(chatId, text);
  }

```

- [ ] **Step 4: Экспортировать сервис из модуля**

Modify `backend/src/telegram/telegram.module.ts` — заменить строку `exports`:
```typescript
  exports: [SequelizeModule, TelegramService],
```

- [ ] **Step 5: Запустить — зелёный**

Run: `cd backend && npx jest telegram.service`
Expected: PASS (включая новый тест делегирования).

- [ ] **Step 6: Commit**

```bash
git add backend/src/telegram/telegram.service.ts backend/src/telegram/telegram.module.ts backend/src/telegram/telegram.service.spec.ts
git commit -m "feat(telegram): публичный sendMessageTo + экспорт TelegramService"
```

---

### Task 3: `AuthService.forgot/reset` + DTO + контроллер + модуль

**Files:**
- Modify: `backend/src/auth/dto/auth.dto.ts`
- Modify: `backend/src/auth/auth.service.ts`
- Modify: `backend/src/auth/auth.controller.ts`
- Modify: `backend/src/auth/auth.module.ts`
- Test: `backend/src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `genResetCode`, `sha256` (Task 1); `TelegramService.sendMessageTo` (Task 2); модель `User` с `passwordResetTokenHash`/`passwordResetExpires`/`telegramChatId`.
- Produces:
  - `ForgotDto { email: string }`, `ResetPasswordDto { token: string; newPassword: string }`.
  - `AuthService.forgot(emailRaw): Promise<{ ok: true }>` — generic, при привязке Telegram шлёт код.
  - `AuthService.reset(token, newPassword): Promise<{ ok: true }>` — 400 при неверном/истёкшем коде.
  - `POST /auth/forgot`, `POST /auth/reset` (оба `@Throttle 5/60s`).

- [ ] **Step 1: Добавить DTO**

Modify `backend/src/auth/dto/auth.dto.ts` — добавить в конец файла (импорты `IsEmail, IsString, MaxLength, MinLength, Transform` уже есть в файле; если `Transform` не импортирован — он есть, используется в `CredentialsDto`):
```typescript
export class ForgotDto {
  @Transform(({ value }) => String(value).trim().toLowerCase())
  @IsEmail() @MaxLength(254)
  email: string;
}

export class ResetPasswordDto {
  @IsString() @MaxLength(64)
  token: string;

  @IsString() @MinLength(8) @MaxLength(128)
  newPassword: string;
}
```

- [ ] **Step 2: Обновить тест-мок и написать падающие тесты forgot/reset**

Modify `backend/src/auth/auth.service.spec.ts`:

(a) Добавить импорты вверху (к существующим):
```typescript
import { BadRequestException } from '@nestjs/common';
import { sha256 } from './reset-code';
```
(`ConflictException`, `ForbiddenException`, `UnauthorizedException` уже импортированы — не дублируй; добавь `BadRequestException` в тот же импорт из `@nestjs/common`.)

(b) Заменить тело `beforeEach` (создание мока и сервиса) на версию с `save`, reset-полями, умным `findOne` и telegram-моком:
```typescript
  let telegram: { sendMessageTo: jest.Mock };

  beforeEach(() => {
    users = {};
    telegram = { sendMessageTo: jest.fn(() => Promise.resolve(true)) };
    const userModel: any = {
      findOne: jest.fn(({ where }) => {
        if (where.email) return Promise.resolve(users[where.email] ?? null);
        if (where.passwordResetTokenHash)
          return Promise.resolve(
            Object.values(users).find((u: any) => u.passwordResetTokenHash === where.passwordResetTokenHash) ?? null,
          );
        return Promise.resolve(null);
      }),
      create: jest.fn((data) => {
        if (users[data.email]) return Promise.reject(new Error('unique'));
        users[data.email] = {
          id: 'u-' + data.email, plan: 'free', role: 'user', blocked: false,
          telegramChatId: null, passwordResetTokenHash: null, passwordResetExpires: null,
          save: jest.fn(function (this: any) { return Promise.resolve(this); }),
          ...data,
        };
        return Promise.resolve(users[data.email]);
      }),
      findByPk: jest.fn((id) =>
        Promise.resolve(Object.values(users).find((u: any) => u.id === id) ?? null)),
      update: jest.fn((vals, { where: { email } }) => {
        if (users[email]) Object.assign(users[email], vals);
        return Promise.resolve([1]);
      }),
    };
    service = new AuthService(userModel, jwt, telegram as any);
  });
```
(Это заменяет прежний `beforeEach`. Прежние тесты login/register/refresh/admin продолжают работать: `findOne` по email и `update` — сохранены, объекты теперь дополнительно имеют `save`/`telegramChatId`/reset-поля.)

(c) Добавить новые тесты в конец `describe('AuthService', ...)`:
```typescript
  it('forgot: привязанный Telegram → код отправлен, поля записаны, {ok:true}', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'x';
    await service.register('a@b.md', 'password1');
    users['a@b.md'].telegramChatId = 'chat-1';
    const res = await service.forgot('A@B.md');
    expect(res).toEqual({ ok: true });
    expect(telegram.sendMessageTo).toHaveBeenCalledWith('chat-1', expect.stringContaining('Код сброса пароля'));
    expect(users['a@b.md'].passwordResetTokenHash).toBeTruthy();
    expect(Number(users['a@b.md'].passwordResetExpires)).toBeGreaterThan(Date.now());
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it('forgot: нет привязки Telegram → не шлёт, всё равно {ok:true}', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'x';
    await service.register('a@b.md', 'password1');
    const res = await service.forgot('a@b.md');
    expect(res).toEqual({ ok: true });
    expect(telegram.sendMessageTo).not.toHaveBeenCalled();
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it('forgot: нет юзера → не шлёт, {ok:true}', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'x';
    const res = await service.forgot('nobody@b.md');
    expect(res).toEqual({ ok: true });
    expect(telegram.sendMessageTo).not.toHaveBeenCalled();
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it('reset: валидный код → меняет пароль, чистит reset-поля', async () => {
    await service.register('a@b.md', 'password1');
    const before = users['a@b.md'].passwordHash;
    users['a@b.md'].passwordResetTokenHash = sha256('CODE1234');
    users['a@b.md'].passwordResetExpires = Date.now() + 60000;
    const res = await service.reset('CODE1234', 'new-password');
    expect(res).toEqual({ ok: true });
    expect(users['a@b.md'].passwordHash).not.toBe(before);
    expect(users['a@b.md'].passwordResetTokenHash).toBeNull();
    expect(users['a@b.md'].passwordResetExpires).toBeNull();
  });

  it('reset: неизвестный код → BadRequestException', async () => {
    await expect(service.reset('NOPE0000', 'new-password')).rejects.toThrow(BadRequestException);
  });

  it('reset: истёкший код → BadRequestException', async () => {
    await service.register('a@b.md', 'password1');
    users['a@b.md'].passwordResetTokenHash = sha256('CODE1234');
    users['a@b.md'].passwordResetExpires = Date.now() - 1000;
    await expect(service.reset('CODE1234', 'new-password')).rejects.toThrow(BadRequestException);
  });
```

- [ ] **Step 3: Запустить — убедиться, что падает**

Run: `cd backend && npx jest auth.service`
Expected: FAIL — `service.forgot is not a function` / конструктор требует 3-й аргумент.

- [ ] **Step 4: Реализовать в `auth.service.ts`**

Modify `backend/src/auth/auth.service.ts`:

(a) Импорты — добавить `BadRequestException` к существующему импорту из `@nestjs/common`; добавить новые строки:
```typescript
import { TelegramService } from '../telegram/telegram.service';
import { genResetCode, sha256 } from './reset-code';
```
(`parseAdminEmails` уже импортируется — не трогай.)

(b) В конструктор добавить третий параметр:
```typescript
  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    private readonly jwt: JwtService,
    private readonly telegram: TelegramService,
  ) {}
```

(c) Добавить два метода (например, после `me`):
```typescript
  // Сброс пароля: шлём код в Telegram, если привязан. Ответ всегда одинаковый (без enumeration).
  async forgot(emailRaw: string) {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.userModel.findOne({ where: { email } });
    if (user && user.telegramChatId && process.env.TELEGRAM_BOT_TOKEN) {
      const code = genResetCode();
      user.passwordResetTokenHash = sha256(code);
      user.passwordResetExpires = Date.now() + 30 * 60 * 1000;
      await user.save();
      await this.telegram.sendMessageTo(
        user.telegramChatId,
        `Код сброса пароля LoadLens: ${code}\nДействует 30 минут. Если вы не запрашивали сброс — игнорируйте.`,
      );
    }
    return { ok: true };
  }

  async reset(token: string, newPassword: string) {
    const hash = sha256(token.trim());
    const user = await this.userModel.findOne({ where: { passwordResetTokenHash: hash } });
    if (!user || user.passwordResetExpires == null || Number(user.passwordResetExpires) < Date.now())
      throw new BadRequestException('недействительный или истёкший код');
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.passwordResetTokenHash = null;
    user.passwordResetExpires = null;
    await user.save();
    return { ok: true };
  }
```

- [ ] **Step 5: Добавить эндпоинты в контроллер**

Modify `backend/src/auth/auth.controller.ts`:

(a) Импорт DTO — добавить к существующему импорту из `./dto/auth.dto`:
```typescript
import { CredentialsDto, RefreshDto, ForgotDto, ResetPasswordDto } from './dto/auth.dto';
```
(b) Добавить методы (например, после `refresh`):
```typescript
  @Post('forgot')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  forgot(@Body() dto: ForgotDto) { return this.service.forgot(dto.email); }

  @Post('reset')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  reset(@Body() dto: ResetPasswordDto) { return this.service.reset(dto.token, dto.newPassword); }
```

- [ ] **Step 6: Подключить TelegramModule в AuthModule**

Modify `backend/src/auth/auth.module.ts`:
(a) Импорт:
```typescript
import { TelegramModule } from '../telegram/telegram.module';
```
(b) В массив `imports` добавить `TelegramModule`:
```typescript
  imports: [
    UsersModule,
    LanesModule,
    TelegramModule,
    JwtModule.register({ secret: process.env.JWT_SECRET || 'dev-secret' }),
  ],
```

- [ ] **Step 7: Запустить тесты и сборку**

Run: `cd backend && npx jest auth.service && npm run build && npm test`
Expected: `auth.service` PASS (включая 6 новых); build OK; полный набор PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/auth/dto/auth.dto.ts backend/src/auth/auth.service.ts backend/src/auth/auth.controller.ts backend/src/auth/auth.module.ts backend/src/auth/auth.service.spec.ts
git commit -m "feat(auth): POST /auth/forgot + /auth/reset (код сброса через Telegram)"
```

---

### Task 4: Попап — поток «Забыл пароль?» + bump расширения

**Files:**
- Modify: `extension/api.js`
- Modify: `extension/popup.js`
- Modify: `extension/manifest.json`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes (HTTP): `POST /api/v1/auth/forgot { email }`, `POST /api/v1/auth/reset { token, newPassword }`.
- Produces: `LLAPI.forgotPassword(email)`, `LLAPI.resetPassword(token, newPassword)`; UI-поток сброса в попапе.

- [ ] **Step 1: Добавить методы в `api.js`**

Modify `extension/api.js` — добавить после функции `changePassword` (перед `return { ... }`):
```javascript
  async function forgotPassword(email) {
    const res = await fetch(`${BASE}/auth/forgot`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message || `ошибка ${res.status}`); }
    return { ok: true };
  }

  async function resetPassword(token, newPassword) {
    const res = await fetch(`${BASE}/auth/reset`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      const m = d.message || `ошибка ${res.status}`;
      throw new Error(Array.isArray(m) ? m.join(", ") : m);
    }
    return { ok: true };
  }
```
И добавить `forgotPassword, resetPassword` в возвращаемый объект `LLAPI` (в строку с `... changePassword, ...`):
```javascript
           getDrivers, createDriver, updateDriver, deleteDriver, deleteAccount, changePassword, forgotPassword, resetPassword,
```

- [ ] **Step 2: Добавить ссылку «Забыл пароль?» в форму логина**

Modify `extension/popup.js` — в функции `accForm`, заменить строку с `.btns` (логин/регистрация), добавив ссылку и обработчик. Найти:
```javascript
    '<div class="btns"><button id="acc-in">Войти</button><button id="acc-reg">Регистрация</button></div>' +
    '<div class="note">Pro: полные 3-плечевые get-out цепочки + CSV-экспорт грузов.</div></div>';
```
заменить на:
```javascript
    '<div class="btns"><button id="acc-in">Войти</button><button id="acc-reg">Регистрация</button></div>' +
    '<div class="note"><button id="acc-forgot" class="linkbtn">Забыл пароль?</button></div>' +
    '<div class="note">Pro: полные 3-плечевые get-out цепочки + CSV-экспорт грузов.</div></div>';
```
И перед закрывающей `}` функции `accForm` (после строк с `acc-in`/`acc-reg` обработчиками) добавить:
```javascript
  document.getElementById("acc-forgot").onclick = () => resetForm(document.getElementById("acc-email").value.trim());
```

- [ ] **Step 3: Добавить функции `resetForm`/`resetCodeForm`**

Modify `extension/popup.js` — добавить сразу после функции `accForm` (после её `}`):
```javascript
// Шаг 1 сброса: ввод email → запрос кода. Контент статический.
function resetForm(prefillEmail) {
  accEl.innerHTML = '<div class="acc"><h4>Сброс пароля</h4>' +
    '<input id="rst-email" type="email" placeholder="email" autocomplete="username">' +
    '<div class="err" id="rst-err"></div>' +
    '<div class="btns"><button id="rst-send">Отправить код</button><button id="rst-cancel">Назад</button></div>' +
    '<div class="note">Если аккаунт привязан к Telegram, код придёт в бот.</div></div>';
  document.getElementById("rst-email").value = prefillEmail || "";
  document.getElementById("rst-cancel").onclick = () => accForm();
  document.getElementById("rst-send").onclick = async () => {
    const email = document.getElementById("rst-email").value.trim();
    const err = document.getElementById("rst-err");
    if (!email) { err.textContent = "введите email"; return; }
    err.textContent = "";
    try { await LLAPI.forgotPassword(email); resetCodeForm(email); }
    catch (e) { err.textContent = e.message; }
  };
}

// Шаг 2 сброса: код из Telegram + новый пароль.
function resetCodeForm(email) {
  accEl.innerHTML = '<div class="acc"><h4>Введите код</h4>' +
    '<input id="rst-code" type="text" placeholder="код из Telegram" autocomplete="one-time-code">' +
    '<input id="rst-new" type="password" placeholder="новый пароль (мин. 8)" autocomplete="new-password">' +
    '<div class="err" id="rst-err2"></div>' +
    '<div class="btns"><button id="rst-do">Сбросить</button><button id="rst-back">Назад</button></div></div>';
  document.getElementById("rst-back").onclick = () => resetForm(email);
  document.getElementById("rst-do").onclick = async () => {
    const code = document.getElementById("rst-code").value.trim();
    const neu = document.getElementById("rst-new").value;
    const err = document.getElementById("rst-err2");
    if (!code) { err.textContent = "введите код"; return; }
    if (neu.length < 8) { err.textContent = "минимум 8 символов"; return; }
    err.textContent = "";
    try { await LLAPI.resetPassword(code, neu); accForm("Пароль сброшен, войдите."); }
    catch (e) { err.textContent = e.message; }
  };
}
```

- [ ] **Step 4: Добавить стиль для `.linkbtn`**

Modify `extension/popup.html` — в блок `<style>` (после правила `.acc .btns`) добавить:
```css
  .linkbtn { background:none; border:none; padding:0; color:#1d4ed8; font:inherit; cursor:pointer; text-decoration:underline; }
```

- [ ] **Step 5: Проверить синтаксис и прогнать тесты**

Run:
```bash
cd /Users/bogdan/work/startup/dat.com
node --check extension/api.js && node --check extension/popup.js && npm test
```
Expected: оба `--check` без ошибок; `npm test` (node --test) — все PASS (api/popup не покрыты, но синтаксис проверен; ничего не сломано).

- [ ] **Step 6: Bump версии + CHANGELOG**

Modify `extension/manifest.json` — `"version": "0.3.2"` → `"version": "0.3.3"`.

Modify `CHANGELOG.md` — добавить под строкой `All notable user-facing changes...`:
```markdown
## 0.3.3 — 2026-06-27

### New
- **Reset a forgotten password from the popup.** A "Забыл пароль?" link on the sign-in screen sends a one-time code to your linked Telegram bot; enter the code and a new password to regain access. Works for accounts that have linked Telegram.
```

- [ ] **Step 7: Commit**

```bash
git add extension/api.js extension/popup.js extension/popup.html extension/manifest.json CHANGELOG.md
git commit -m "feat(popup): поток «Забыл пароль?» (forgot/reset) + bump 0.3.2 → 0.3.3"
```

---

## Self-Review

**Spec coverage:**
- Колонки `password_reset_*` + ALTER → Task 1 ✓
- `genResetCode`/`sha256` (алфавит, sha256 в БД) → Task 1 ✓
- `TelegramService.sendMessageTo` + экспорт → Task 2 ✓
- `POST /auth/forgot` (generic, Telegram-доставка при привязке) → Task 3 ✓
- `POST /auth/reset` (sha256-поиск, expiry-проверка, одноразовость, bcrypt) → Task 3 ✓
- DTO ForgotDto/ResetPasswordDto + Throttle → Task 3 ✓
- AuthModule ↔ TelegramModule (без цикла) → Task 3 ✓
- Попап: forgotPassword/resetPassword + «Забыл пароль?» поток → Task 4 ✓
- Bump + CHANGELOG → Task 4 ✓
- Тесты forgot/reset/genResetCode/delegation → Tasks 1,2,3 ✓

**Placeholder scan:** код во всех шагах полный, плейсхолдеров нет.

**Type consistency:** `genResetCode()`/`sha256()` (Task 1) — те же имена в Task 3. `sendMessageTo(chatId, text)` (Task 2) — так же вызывается в `AuthService.forgot` (Task 3). DTO `ForgotDto.email`, `ResetPasswordDto.{token,newPassword}` (Task 3 step 1) совпадают с использованием в контроллере (step 5) и `LLAPI.forgotPassword/resetPassword` (Task 4). Колонки `passwordResetTokenHash`/`passwordResetExpires` (Task 1) — так же в сервисе и тест-моке (Task 3). Конструктор `AuthService(userModel, jwt, telegram)` (Task 3 step 4) совпадает с инстанцированием в спеке (step 2b).

**Note по BIGINT:** Sequelize может вернуть `passwordResetExpires` строкой — в `reset` сравнение обёрнуто `Number(...)`, в тесте поле — число; обе ветки корректны.
