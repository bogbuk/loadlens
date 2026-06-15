import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Driver } from './driver.model';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';

// «Свежий» водитель: полный ресурс часов (минуты) — как FRESH в extension/hos.js.
export const FRESH_HOS = { remainingDrive: 11 * 60, remainingOnDuty: 14 * 60, remainingCycle: 70 * 60 };

@Injectable()
export class DriversService {
  constructor(@InjectModel(Driver) private readonly model: typeof Driver) {}

  list(userId: string): Promise<Driver[]> {
    return this.model.findAll({ where: { userId }, order: [['createdAt', 'ASC']] });
  }

  create(userId: string, dto: CreateDriverDto): Promise<Driver> {
    return this.model.create({ ...dto, userId, hos: dto.hos ?? FRESH_HOS } as any);
  }

  async update(userId: string, id: string, dto: UpdateDriverDto): Promise<Driver> {
    const row = await this.model.findOne({ where: { id, userId } });
    if (!row) throw new NotFoundException('водитель не найден');
    await row.update(dto as any);
    return row;
  }

  async remove(userId: string, id: string): Promise<{ ok: true }> {
    const n = await this.model.destroy({ where: { id, userId } });
    if (!n) throw new NotFoundException('водитель не найден');
    return { ok: true };
  }
}
