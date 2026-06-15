/* LoadLens — матчер «все водители сразу»: для груза считает, кому из парка он подходит
   (HOS-выполним + прицеп + выгодность). Zero-dep CommonJS (браузер+Node+тесты).
   Зависит от глобалов LLPLAN (stepHos/legMinutes) и LLSCORE (netRpm) — грузятся раньше.

   Форма водителя (как в backend Driver / LLAPI.getDrivers):
   { id, name, currentMarket, equipment|null, costPerMile|null, status, hos:{remainingDrive,remainingOnDuty,remainingCycle} } */
const LLFLEET = (() => {
  "use strict";

  function matchLoadToFleet(load, drivers, ctx = {}) {
    const distance = ctx.distance || (() => 0);
    const pool = (drivers || []).filter((d) => d && d.status !== "off"); // off — не матчим
    const matches = pool.map((dr) => {
      const equipMatch = !dr.equipment || dr.equipment === load.equipment;  // null прицеп = не исключаем
      const deadhead = dr.currentMarket
        ? Math.round(distance(dr.currentMarket, load.originMarket))
        : (load.deadheadMiles || 0);
      const driveMin = LLPLAN.legMinutes((load.loadedMiles || 0) + deadhead);
      const hos = LLPLAN.stepHos(dr.hos || {}, driveMin, 120);
      const hosBadge = hos.feasible ? hos.badge : "red";
      const costPerMile = dr.costPerMile != null ? dr.costPerMile : ctx.costPerMile;
      const netRpm = LLSCORE.netRpm({ ...load, deadheadMiles: deadhead },
        { dieselPrice: ctx.dieselPrice, costPerMile });
      return { driverId: dr.id, name: dr.name, equipMatch, deadhead, hosBadge, netRpm,
               costPerMile, feasible: equipMatch && hos.feasible };
    });
    matches.sort((a, b) =>
      (Number(b.feasible) - Number(a.feasible)) || ((b.netRpm ?? -Infinity) - (a.netRpm ?? -Infinity)));
    const feasibleCount = matches.filter((m) => m.feasible).length;
    return { matches, best: feasibleCount ? matches[0] : null, feasibleCount, total: matches.length };
  }

  return { matchLoadToFleet };
})();

if (typeof module !== "undefined" && module.exports) module.exports = LLFLEET;
if (typeof globalThis !== "undefined") globalThis.LLFLEET = LLFLEET;
