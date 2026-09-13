import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/sequelize';
import type { Sequelize } from 'sequelize';
import { json } from 'express';
import { AppModule } from './app.module';
import { parseAdminEmails } from './auth/admin-emails';

async function bootstrap() {
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET)
    throw new Error('JWT_SECRET is required in production');
  // Без DATABASE_URL Sequelize молча уходит на дефолт (unix-сокет + БД по имени юзера ОС) —
  // с synchronize:true это значит создать схему LoadLens в чужой/личной базе разработчика.
  // Падаем до инициализации Sequelize, а не после.
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  const app = await NestFactory.create(AppModule);
  // POST /loads с полным набором полей (200 грузов × ~2КБ) не влезает в дефолтные 100kb → 413.
  // Наш парсер регистрируется раньше дефолтного body-parser'а и перекрывает его лимит.
  app.use(json({ limit: '2mb' }));
  const sequelize = app.get<Sequelize>(getConnectionToken());
  await sequelize.query(
    'ALTER TABLE loads ADD COLUMN IF NOT EXISTS seen_count INTEGER NOT NULL DEFAULT 1',
  );
  // Полный набор полей парсера (2026-07-17): synchronize не меняет существующие таблицы —
  // добавляем идемпотентно. Типы соответствуют load.model.ts.
  const loadCols: Array<[string, string]> = [
    ['origin_city', 'TEXT'], ['origin_state', 'TEXT'], ['dest_city', 'TEXT'], ['dest_state', 'TEXT'],
    ['length_ft', 'INTEGER'], ['equipment_code', 'TEXT'], ['full_partial', 'TEXT'],
    ['trip_method', 'TEXT'], ['dest_deadhead_miles', 'REAL'], ['rate_basis', 'TEXT'],
    ['credit_score', 'INTEGER'], ['days_to_pay', 'REAL'], ['credit_as_of', 'TEXT'],
    ['broker_city', 'TEXT'], ['broker_state', 'TEXT'],
    ['is_factorable', 'BOOLEAN'], ['is_assurable', 'BOOLEAN'], ['is_negotiable', 'BOOLEAN'],
    ['has_tia_membership', 'BOOLEAN'], ['from_private_network', 'BOOLEAN'],
    ['is_obfuscated', 'BOOLEAN'], ['book_now', 'BOOLEAN'],
    ['booking_method', 'TEXT'], ['booking_url', 'TEXT'], ['bid_count', 'INTEGER'],
    ['serviced_when', 'TEXT'], ['posting_expires_when', 'TEXT'], ['presentation_date', 'TEXT'],
    ['pickup_earliest', 'TEXT'], ['pickup_latest', 'TEXT'],
    ['dot_number', 'TEXT'], ['carrier_mc', 'TEXT'], ['freight_forwarder_mc', 'TEXT'],
    ['combined_office_id', 'TEXT'], ['headquarters_id', 'TEXT'], ['poster_user_id', 'TEXT'],
    ['estimated_rate_per_mile', 'REAL'],
    ['comments', 'TEXT'], ['contact_email', 'TEXT'], ['contact_phone', 'TEXT'],
    ['preferred_contact_method', 'TEXT'],
  ];
  for (const [col, type] of loadCols)
    await sequelize.query(`ALTER TABLE loads ADD COLUMN IF NOT EXISTS ${col} ${type}`);
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
  await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0');
  await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS device_evictions INTEGER NOT NULL DEFAULT 0');
  await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS cloud_enabled BOOLEAN NOT NULL DEFAULT false');
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
