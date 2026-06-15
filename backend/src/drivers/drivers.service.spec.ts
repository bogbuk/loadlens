import { NotFoundException } from '@nestjs/common';
import { DriversService, FRESH_HOS } from './drivers.service';

function svcWith(model: any) { return new DriversService(model as any); }

describe('DriversService', () => {
  it('list фильтрует по userId', async () => {
    const findAll = jest.fn().mockResolvedValueOnce([{ id: 'd1' }]);
    const res = await svcWith({ findAll }).list('u1');
    expect(findAll).toHaveBeenCalledWith({ where: { userId: 'u1' }, order: [['createdAt', 'ASC']] });
    expect(res).toEqual([{ id: 'd1' }]);
  });

  it('create подставляет userId и дефолтный hos', async () => {
    const create = jest.fn().mockImplementation(async (v: any) => ({ id: 'd1', ...v }));
    const res = await svcWith({ create }).create('u1', { name: 'Bob' } as any);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', name: 'Bob', hos: FRESH_HOS }));
    expect(res.id).toBe('d1');
  });

  it('create уважает переданный hos', async () => {
    const create = jest.fn().mockImplementation(async (v: any) => v);
    const hos = { remainingDrive: 120, remainingOnDuty: 240, remainingCycle: 600 };
    await svcWith({ create }).create('u1', { name: 'Bob', hos } as any);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ hos }));
  });

  it('update находит по id+userId и патчит', async () => {
    const row = { update: jest.fn().mockResolvedValue(undefined) };
    const findOne = jest.fn().mockResolvedValueOnce(row);
    const res = await svcWith({ findOne }).update('u1', 'd1', { status: 'active' } as any);
    expect(findOne).toHaveBeenCalledWith({ where: { id: 'd1', userId: 'u1' } });
    expect(row.update).toHaveBeenCalledWith({ status: 'active' });
    expect(res).toBe(row);
  });

  it('update чужого водителя → NotFound', async () => {
    const findOne = jest.fn().mockResolvedValueOnce(null);
    await expect(svcWith({ findOne }).update('u1', 'dX', {} as any)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove по id+userId; ничего не удалено → NotFound', async () => {
    const destroyOk = jest.fn().mockResolvedValueOnce(1);
    await expect(svcWith({ destroy: destroyOk }).remove('u1', 'd1')).resolves.toEqual({ ok: true });
    expect(destroyOk).toHaveBeenCalledWith({ where: { id: 'd1', userId: 'u1' } });

    const destroyNone = jest.fn().mockResolvedValueOnce(0);
    await expect(svcWith({ destroy: destroyNone }).remove('u1', 'dX')).rejects.toBeInstanceOf(NotFoundException);
  });
});
