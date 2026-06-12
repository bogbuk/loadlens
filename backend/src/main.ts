import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET)
    throw new Error('JWT_SECRET обязателен в проде');

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1', { exclude: ['healthz'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: [/^https:\/\/([a-z0-9-]+\.)?dat\.com$/, /^https:\/\/([a-z0-9-]+\.)?truckstop\.com$/,
             /^chrome-extension:\/\/[a-p]{32}$/],
    methods: ['GET', 'POST', 'PATCH'],
  });

  await app.listen(Number(process.env.PORT ?? 3000));
}
bootstrap();
