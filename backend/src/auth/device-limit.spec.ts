import { DEVICE_LIMIT, decideDevices, DeviceRow } from './device-limit';

const d = (clientId: string, minutesAgo: number): DeviceRow =>
  ({ clientId, lastSeenAt: new Date(Date.parse('2026-07-20T12:00:00Z') - minutesAgo * 60000) });
const NOW = new Date('2026-07-20T12:00:00Z');
const ids = (rows: DeviceRow[]) => rows.map((r) => r.clientId).sort();

describe('decideDevices', () => {
  it('лимит по умолчанию — 3', () => {
    expect(DEVICE_LIMIT).toBe(3);
  });

  it('известное устройство не тратит слот и не вытесняет никого', () => {
    const devices = [d('a', 100), d('b', 50), d('c', 10)];
    const r = decideDevices(devices, 'b', 'pro', NOW);
    expect(r.evict).toEqual([]);
    expect(ids(r.keep)).toEqual(['a', 'b', 'c']);
  });

  it('известное устройство получает свежий lastSeenAt', () => {
    const r = decideDevices([d('a', 100), d('b', 50)], 'b', 'pro', NOW);
    expect(r.keep.find((x) => x.clientId === 'b')!.lastSeenAt).toEqual(NOW);
  });

  it('свободный слот — новое устройство просто добавляется', () => {
    const r = decideDevices([d('a', 100), d('b', 50)], 'c', 'pro', NOW);
    expect(r.evict).toEqual([]);
    expect(ids(r.keep)).toEqual(['a', 'b', 'c']);
  });

  it('переполнение у pro — вытесняется самое давнее по lastSeenAt', () => {
    const devices = [d('old', 500), d('mid', 100), d('new', 10)];
    const r = decideDevices(devices, 'fresh', 'pro', NOW);
    expect(ids(r.evict)).toEqual(['old']);
    expect(ids(r.keep)).toEqual(['fresh', 'mid', 'new']);
  });

  it('порядок вытеснения — по lastSeenAt, а не по порядку в массиве', () => {
    const devices = [d('recent', 5), d('ancient', 9999), d('mid', 100)];
    const r = decideDevices(devices, 'fresh', 'pro', NOW);
    expect(ids(r.evict)).toEqual(['ancient']);
  });

  it('переполнение у free — не вытесняем ничего', () => {
    const devices = [d('a', 500), d('b', 100), d('c', 10)];
    const r = decideDevices(devices, 'dd', 'free', NOW);
    expect(r.evict).toEqual([]);
    expect(r.keep).toHaveLength(4);
  });

  it('апгрейд free→pro с пятью устройствами подрезает до трёх самых свежих', () => {
    const devices = [d('a', 500), d('b', 400), d('c', 300), d('d', 200), d('e', 100)];
    const r = decideDevices(devices, 'e', 'pro', NOW);
    expect(ids(r.evict)).toEqual(['a', 'b']);
    expect(ids(r.keep)).toEqual(['c', 'd', 'e']);
  });

  it('текущее устройство не вытесняется никогда, даже если его строка была самой старой', () => {
    const devices = [d('me', 9999), d('b', 100), d('c', 50), d('dd', 10)];
    const r = decideDevices(devices, 'me', 'pro', NOW);
    expect(r.evict.map((x) => x.clientId)).not.toContain('me');
    expect(r.keep).toHaveLength(3);
  });

  it('пустой список устройств — первое устройство просто добавляется', () => {
    const r = decideDevices([], 'a', 'pro', NOW);
    expect(r.evict).toEqual([]);
    expect(ids(r.keep)).toEqual(['a']);
  });
});
