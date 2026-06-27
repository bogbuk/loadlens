import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/sequelize';
import type { Sequelize } from 'sequelize';
import { AppModule } from './app.module';
import { parseAdminEmails } from './auth/admin-emails';

async function bootstrap() {
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET)
    throw new Error('JWT_SECRET обязателен в проде');

  const app = await NestFactory.create(AppModule);
  const sequelize = app.get<Sequelize>(getConnectionToken());
  await sequelize.query(
    'ALTER TABLE loads ADD COLUMN IF NOT EXISTS seen_count INTEGER NOT NULL DEFAULT 1',
  );
  // synchronize не меняет существующие таблицы — Telegram-колонки добавляем идемпотентно.
  await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT');
  await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_link_token TEXT');
  await sequelize.query(
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS alerts_enabled BOOLEAN NOT NULL DEFAULT false',
  );
  await sequelize.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'");
  await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT false');
  await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT');
  await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires BIGINT');
  // Bootstrap админов из ADMIN_EMAIL (идемпотентно): уже существующие юзеры получают role=admin.
  const adminEmails = parseAdminEmails(process.env.ADMIN_EMAIL);
  if (adminEmails.length)
    // blocked НЕ повышаем: иначе «заблокированный админ» не залогинится и его нельзя разблокировать из панели.
    await sequelize.query("UPDATE users SET role='admin' WHERE email IN (:emails) AND blocked = false", {
      replacements: { emails: adminEmails },
    });
  app.setGlobalPrefix('api/v1', { exclude: ['healthz'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: [/^https:\/\/([a-z0-9-]+\.)?dat\.com$/, /^https:\/\/([a-z0-9-]+\.)?truckstop\.com$/,
             /^chrome-extension:\/\/[a-p]{32}$/],
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  await app.listen(Number(process.env.PORT ?? 3000));
}
bootstrap();
