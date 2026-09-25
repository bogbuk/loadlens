import { PATH_METADATA } from '@nestjs/common/constants';
import { LoadsController } from './loads.controller';

// Партнёрская выдача (GET /loads/partner) отключена 2026-09-25: передача собранных у пользователей
// постингов третьим лицам не укладывается в Limited Use Chrome Web Store. Маршрут не должен вернуться.
describe('LoadsController routes', () => {
  const paths = Object.getOwnPropertyNames(LoadsController.prototype)
    .filter((m) => m !== 'constructor')
    .map((m) => Reflect.getMetadata(PATH_METADATA, (LoadsController.prototype as any)[m]))
    .filter((p) => p !== undefined);

  it('не публикует партнёрскую выдачу /loads/partner', () => {
    expect(paths).not.toContain('partner');
  });

  it('оставляет ingest, near и выдачу по рынку', () => {
    expect(paths).toEqual(expect.arrayContaining(['/', 'near']));
  });
});
