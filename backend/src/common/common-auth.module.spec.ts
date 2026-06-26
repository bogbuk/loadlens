import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { User } from '../users/user.model';
import { CommonAuthModule } from './common-auth.module';
import { PremiumReadGuard } from './premium-read.guard';

// Bootstrap-тест DI-графа: ловит баг, который юнит-тест гарда (new Guard(mock, mock)) пропускает.
// При @UseGuards(PremiumReadGuard) Nest резолвит гард в контексте ПОТРЕБЛЯЮЩЕГО модуля, поэтому
// CommonAuthModule обязан экспортировать SequelizeModule (UserRepository) + JwtModule (JwtService).
// Если экспорты убрать — .compile() бросит "can't resolve dependencies of PremiumReadGuard
// ... UserRepository ... available in the ProbeModule context" (ровно прод-краш 2026-06-26).

@UseGuards(PremiumReadGuard)
@Controller('probe')
class ProbeController {
  @Get()
  ok() {
    return 'ok';
  }
}

// Зеркалит реальные read-модули (lanes/markets/geo/rates/loads/brokers): импорт CommonAuthModule
// + контроллер с гардом на чтении.
@Module({ imports: [CommonAuthModule], controllers: [ProbeController] })
class ProbeModule {}

describe('CommonAuthModule (bootstrap DI)', () => {
  it('PremiumReadGuard резолвится в потребляющем модуле через @UseGuards', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] })
      // мок UserRepository — чтобы не поднимать реальное подключение к БД
      .overrideProvider(getModelToken(User))
      .useValue({ findByPk: jest.fn() })
      .compile();

    expect(moduleRef.get(PremiumReadGuard, { strict: false })).toBeInstanceOf(PremiumReadGuard);
    await moduleRef.close();
  });
});
