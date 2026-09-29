import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { User } from '../users/user.model';
import { AlertSend } from '../telegram/alert-send.model';
import { TrialModule } from './trial.module';
import { TrialNoticesService } from './trial-notices.service';

// Bootstrap-тест DI-графа (как common-auth.module.spec.ts): TrialNoticesService нужны UserRepository
// и TelegramService из TelegramModule. Юнит-тест сервиса (new Service(mock, mock)) этого не проверяет,
// а ошибка резолва роняет всё приложение при старте.
describe('TrialModule (bootstrap DI)', () => {
  it('TrialNoticesService резолвится со своими зависимостями', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TrialModule] })
      .overrideProvider(getModelToken(User)).useValue({ findAll: jest.fn() })
      .overrideProvider(getModelToken(AlertSend)).useValue({})
      .compile();
    expect(moduleRef.get(TrialNoticesService)).toBeInstanceOf(TrialNoticesService);
    await moduleRef.close();
  });
});
