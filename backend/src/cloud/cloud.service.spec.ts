import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { CloudService } from './cloud.service';

// Ошибочные пути enable/disable пишут в Nest Logger — глушим, чтобы вывод прогона был чистым.
jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

function makeService(opts: { inst?: any; configured?: boolean; fqdn?: string | null } = {}) {
  process.env.CLOUD_IMAGE_TAG = 'latest';
  let inst = opts.inst === undefined ? null : opts.inst;
  const saved: any[] = [];
  // save — jest.fn: тестам нужен не только факт записи, но и её порядок относительно вызовов Coolify.
  const withSave = (row: any) => { row.save = jest.fn(async () => { saved.push({ ...row }); }); return row; };
  const instances = {
    findOne: jest.fn().mockImplementation(async () => inst),
    findOrCreate: jest.fn().mockImplementation(async ({ defaults }: any) => {
      if (inst) return [inst, false];
      inst = withSave({ id: 'inst-1', loadsSeen: 0, ...defaults });
      return [inst, true];
    }),
    findAll: jest.fn().mockImplementation(async () => (inst ? [inst] : [])),
  };
  if (inst) withSave(inst);
  const coolify = {
    configured: opts.configured !== false,
    createService: jest.fn().mockResolvedValue({ uuid: 'svc-1' }),
    setEnv: jest.fn().mockResolvedValue(undefined),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    restart: jest.fn().mockResolvedValue(undefined),
    deleteService: jest.fn().mockResolvedValue(undefined),
    getFqdn: jest.fn().mockResolvedValue(opts.fqdn === undefined ? 'browser-x.cloud.loadlens.krait.studio' : opts.fqdn),
  };
  const users = { findByPk: jest.fn().mockResolvedValue({ id: 'u1', telegramChatId: '42' }) };
  const telegram = { sendMessageTo: jest.fn().mockResolvedValue(true) };
  const svc = new CloudService(instances as any, users as any, coolify as any, telegram as any);
  return { svc, instances, coolify, telegram, saved, get inst() { return inst; } };
}

describe('CloudService.enable', () => {
  it('без COOLIFY_API_URL → 503', async () => {
    const { svc } = makeService({ configured: false });
    await expect(svc.enable('u1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('первый Enable: создаёт строку, сервис в Coolify, env пароля, старт, FQDN; статус starting', async () => {
    const { svc, coolify, instances } = makeService();
    const view = await svc.enable('u1');
    expect(instances.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1' },
      defaults: expect.objectContaining({ userId: 'u1', status: 'starting' }),
    }));
    expect(coolify.createService).toHaveBeenCalledWith(expect.objectContaining({ name: expect.stringMatching(/^ll-/) }));
    const compose = coolify.createService.mock.calls[0][0].compose;
    expect(compose).toContain('LL_INSTANCE_ID=inst-1');
    expect(coolify.setEnv).toHaveBeenCalledWith('svc-1', 'NOVNC_PASSWORD', expect.stringMatching(/^[A-Za-z0-9]{20}$/));
    expect(coolify.start).toHaveBeenCalledWith('svc-1');
    expect(view).toEqual(expect.objectContaining({ enabled: true, status: 'starting', screenDomain: 'browser-x.cloud.loadlens.krait.studio' }));
  });

  it('повторный Enable при живом сервисе — идемпотентен: ничего не создаёт и не стартует', async () => {
    const { svc, coolify } = makeService({ inst: { id: 'inst-1', userId: 'u1', coolifyServiceUuid: 'svc-1', status: 'ok', vncPassword: 'p', screenDomain: 'd' } });
    const view = await svc.enable('u1');
    expect(coolify.createService).not.toHaveBeenCalled();
    expect(coolify.start).not.toHaveBeenCalled();
    expect(view.status).toBe('ok');
  });

  it('Enable после Disable: ротирует пароль, стартует существующий сервис, снимает disabledAt', async () => {
    const { svc, coolify, inst } = makeService({ inst: { id: 'inst-1', userId: 'u1', coolifyServiceUuid: 'svc-1', status: 'stopped', vncPassword: 'old', screenDomain: 'd', disabledAt: new Date() } });
    const view = await svc.enable('u1');
    expect(coolify.createService).not.toHaveBeenCalled();
    expect(coolify.setEnv).toHaveBeenCalledWith('svc-1', 'NOVNC_PASSWORD', expect.not.stringMatching(/^old$/));
    expect(coolify.start).toHaveBeenCalledWith('svc-1');
    expect(view.status).toBe('starting');
    expect(inst.disabledAt).toBeNull();
  });

  it('строка без uuid (гонка двойного Enable): createService ровно один раз, uuid сохранён до start', async () => {
    const h = makeService({ inst: { id: 'inst-1', userId: 'u1', coolifyServiceUuid: null, status: 'starting', vncPassword: 'p', screenDomain: null, loadsSeen: 0 } });
    await h.svc.enable('u1');
    expect(h.coolify.createService).toHaveBeenCalledTimes(1);
    // Ранний save важен: параллельный запрос должен увидеть uuid до того, как мы дойдём до start.
    expect(h.inst.save.mock.invocationCallOrder[0]).toBeLessThan(h.coolify.start.mock.invocationCallOrder[0]);
    expect(h.inst.coolifyServiceUuid).toBe('svc-1');
  });

  it('Coolify упал на create → статус error, ошибка пробрасывается как 502', async () => {
    // Строку создаёт сам enable, поэтому inst читаем через геттер харнесса, а не деструктуризацией.
    const h = makeService();
    h.coolify.createService.mockRejectedValue(new Error('boom'));
    await expect(h.svc.enable('u1')).rejects.toMatchObject({ status: 502 });
    expect(h.inst.status).toBe('error');
  });
});

describe('CloudService.disable / status / screen / heartbeat', () => {
  const live = () => ({ id: 'inst-1', userId: 'u1', coolifyServiceUuid: 'svc-1', status: 'ok', vncPassword: 'p', screenDomain: 'd.example', lastHeartbeatAt: new Date('2026-09-13T10:00:00Z'), loadsSeen: 5 });

  it('disable: stop, статус stopped, disabledAt=now; без инстанса — off', async () => {
    const { svc, coolify, inst } = makeService({ inst: live() });
    const view = await svc.disable('u1');
    expect(coolify.stop).toHaveBeenCalledWith('svc-1');
    expect(view.status).toBe('stopped');
    expect(inst.disabledAt).toBeInstanceOf(Date);
    const empty = makeService();
    expect((await empty.svc.disable('u1')).status).toBe('off');
    expect(empty.coolify.stop).not.toHaveBeenCalled();
  });

  it('status: off без строки; иначе статус + heartbeat ISO + loadsSeen + домен', async () => {
    expect(await makeService().svc.status('u1')).toEqual({ enabled: true, status: 'off', lastHeartbeatAt: null, loadsSeen: 0, screenDomain: null });
    expect(await makeService({ inst: live() }).svc.status('u1')).toEqual({
      enabled: true, status: 'ok', lastHeartbeatAt: '2026-09-13T10:00:00.000Z', loadsSeen: 5, screenDomain: 'd.example',
    });
  });

  it('screen: url noVNC с autoconnect БЕЗ пароля в query (пароль отдельно, вводится в диалоге); без домена/остановленный → 409', async () => {
    const { svc } = makeService({ inst: live() });
    expect(await svc.screen('u1')).toEqual({ url: 'https://d.example/vnc.html?autoconnect=1&resize=scale', password: 'p' });
    await expect(makeService({ inst: { ...live(), status: 'stopped' } }).svc.screen('u1')).rejects.toMatchObject({ status: 409 });
    await expect(makeService({ inst: { ...live(), screenDomain: null } }).svc.screen('u1')).rejects.toMatchObject({ status: 409 });
    await expect(makeService().svc.screen('u1')).rejects.toMatchObject({ status: 409 });
  });

  it('heartbeat: пишет статус/время/loadsSeen; ok сбрасывает lastStateNotified; stopped не оживляет', async () => {
    const { svc, inst } = makeService({ inst: { ...live(), status: 'stale', lastStateNotified: 'stale' } });
    await svc.heartbeat('u1', { state: 'ok', loadsSeen: 40, lastFindLoadsAt: 1 });
    expect(inst.status).toBe('ok'); expect(inst.loadsSeen).toBe(40); expect(inst.lastStateNotified).toBeNull();
    await svc.heartbeat('u1', { state: 'logged_out', loadsSeen: 0, lastFindLoadsAt: null });
    expect(inst.status).toBe('logged_out');
    const stopped = makeService({ inst: { ...live(), status: 'stopped' } });
    await stopped.svc.heartbeat('u1', { state: 'ok', loadsSeen: 1, lastFindLoadsAt: 1 });
    expect(stopped.inst.status).toBe('stopped');
    await expect(makeService().svc.heartbeat('u1', { state: 'ok', loadsSeen: 1, lastFindLoadsAt: 1 })).resolves.toEqual({ ok: true });
  });
});

describe('CloudService.purgeForUser', () => {
  const live = () => ({ id: 'inst-1', userId: 'u1', coolifyServiceUuid: 'svc-1', status: 'ok', vncPassword: 'p', screenDomain: 'd.example', loadsSeen: 0, destroy: jest.fn() });

  it('останавливает, удаляет сервис вместе с томом и сносит строку', async () => {
    const { svc, coolify, inst } = makeService({ inst: live() });
    await svc.purgeForUser('u1');
    expect(coolify.stop).toHaveBeenCalledWith('svc-1');
    expect(coolify.deleteService).toHaveBeenCalledWith('svc-1', { deleteVolumes: true });
    expect(inst.destroy).toHaveBeenCalled();
  });

  it('падение Coolify не мешает: строка всё равно уничтожается', async () => {
    const { svc, coolify, inst } = makeService({ inst: live() });
    coolify.stop.mockRejectedValue(new Error('coolify down'));
    coolify.deleteService.mockRejectedValue(new Error('coolify down'));
    await expect(svc.purgeForUser('u1')).resolves.toBeUndefined();
    expect(inst.destroy).toHaveBeenCalled();
  });

  it('без строки — no-op, Coolify не дёргаем', async () => {
    const { svc, coolify } = makeService();
    await svc.purgeForUser('u1');
    expect(coolify.stop).not.toHaveBeenCalled();
    expect(coolify.deleteService).not.toHaveBeenCalled();
  });
});

describe('CloudService.runWatchdog', () => {
  const base = () => ({ id: 'inst-1', userId: 'u1', coolifyServiceUuid: 'svc-1', vncPassword: 'p', screenDomain: 'd.example', loadsSeen: 0, lastStateNotified: null, disabledAt: null });

  it('ok без heartbeat 15 мин → restart, статус stale, DM "restarted" с ссылкой, lastStateNotified=stale', async () => {
    const { svc, coolify, telegram, inst } = makeService({ inst: { ...base(), status: 'ok', lastHeartbeatAt: new Date(Date.now() - 16 * 60000) } });
    const r = await svc.runWatchdog();
    expect(coolify.restart).toHaveBeenCalledWith('svc-1');
    expect(inst.status).toBe('stale');
    expect(inst.lastStateNotified).toBe('stale');
    expect(telegram.sendMessageTo).toHaveBeenCalledWith('42', expect.stringContaining('https://d.example/vnc.html'));
    expect(r).toEqual({ restarted: 1, notified: 1, swept: 0 });
  });

  it('logged_out → DM один раз; второй прогон молчит', async () => {
    const { svc, telegram } = makeService({ inst: { ...base(), status: 'logged_out', lastHeartbeatAt: new Date() } });
    await svc.runWatchdog(); await svc.runWatchdog();
    expect(telegram.sendMessageTo).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessageTo.mock.calls[0][1]).toContain('signed out of DAT');
  });

  it('без Telegram — статус помечаем, DM не шлём и не падаем', async () => {
    const m = makeService({ inst: { ...base(), status: 'stale', lastHeartbeatAt: new Date() } });
    m.telegram.sendMessageTo.mockClear();
    (m.svc as any).users.findByPk.mockResolvedValue({ id: 'u1', telegramChatId: null });
    await expect(m.svc.runWatchdog()).resolves.toEqual({ restarted: 0, notified: 0, swept: 0 });
    expect(m.inst.lastStateNotified).toBe('stale');
  });

  it('stopped > 30 дней → delete с volume, строка удаляется', async () => {
    const { svc, coolify, inst } = makeService({ inst: { ...base(), status: 'stopped', disabledAt: new Date(Date.now() - 31 * 86400000) } });
    inst.destroy = jest.fn();
    await svc.runWatchdog();
    expect(coolify.deleteService).toHaveBeenCalledWith('svc-1', { deleteVolumes: true });
    expect(inst.destroy).toHaveBeenCalled();
  });

  it('без COOLIFY_API_URL — no-op', async () => {
    const { svc, instances } = makeService({ configured: false, inst: { ...base(), status: 'logged_out' } });
    await expect(svc.runWatchdog()).resolves.toEqual({ restarted: 0, notified: 0, swept: 0 });
    expect(instances.findAll).not.toHaveBeenCalled();
  });
});
