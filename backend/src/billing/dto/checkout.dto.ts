import { IsIn, IsOptional } from 'class-validator';

export class CheckoutDto {
  // Пусто → месяц (старые сборки расширения шлют POST без тела).
  @IsOptional()
  @IsIn(['month', 'year'])
  interval?: 'month' | 'year';
}
