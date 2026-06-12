import { rpmCents } from './loads.service';

describe('rpmCents', () => {
  it('считает центы/милю из rate и груженых+deadhead миль', () => {
    // $2000 / (900+100) = $2.00/mi = 200 центов
    expect(rpmCents(2000, 900, 100)).toBe(200);
  });

  it('учитывает deadhead в знаменателе', () => {
    // $2500 / 1000 = $2.50 без DH; с DH 150 -> 2500/1150 = $2.17 = 217
    expect(rpmCents(2500, 1000, 0)).toBe(250);
    expect(rpmCents(2500, 1000, 150)).toBe(217);
  });

  it('null при отсутствии rate или нулевых милях', () => {
    expect(rpmCents(null, 1000, 0)).toBeNull();
    expect(rpmCents(2000, 0, 0)).toBeNull();
    expect(rpmCents(2000, null, null)).toBeNull();
  });
});
