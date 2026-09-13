import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SequelizeModule } from '@nestjs/sequelize';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { Load } from './loads/load.model';
import { LoadsModule } from './loads/loads.module';
import { LanesModule } from './lanes/lanes.module';
import { MarketsModule } from './markets/markets.module';
import { LaneDistance } from './geo/lane-distance.model';
import { GeoModule } from './geo/geo.module';
import { BrokerReport } from './brokers/broker-report.model';
import { BrokersModule } from './brokers/brokers.module';
import { RatesModule } from './rates/rates.module';
import { User } from './users/user.model';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { Driver } from './drivers/driver.model';
import { DriversModule } from './drivers/drivers.module';
import { AlertSend } from './telegram/alert-send.model';
import { TelegramModule } from './telegram/telegram.module';
import { HealthController } from './health/health.controller';
import { CloudInstance } from './cloud/cloud-instance.model';

@Module({
  imports: [
    SequelizeModule.forRoot({
      dialect: 'postgres',
      uri: process.env.DATABASE_URL,
      models: [Load, LaneDistance, BrokerReport, User, Driver, AlertSend, CloudInstance],
      autoLoadModels: true,
      synchronize: true,
      logging: false,
    }),
    ThrottlerModule.forRoot([{
      ttl: Number(process.env.THROTTLE_TTL ?? 60000),
      limit: Number(process.env.THROTTLE_LIMIT ?? 120),
    }]),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: ['/api/(.*)', '/healthz'],
    }),
    LoadsModule,
    LanesModule,
    MarketsModule,
    GeoModule,
    BrokersModule,
    RatesModule,
    UsersModule,
    AuthModule,
    DriversModule,
    TelegramModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
