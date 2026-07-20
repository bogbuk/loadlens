const fs = require("fs");

class HOSCalculator {
  constructor(cycle = "70-hour", options = {}) {
    this.cycle = cycle;
    this.DRIVING_LIMIT = 11 * 60;
    this.ON_DUTY_LIMIT = 14 * 60;
    this.BREAK_REQUIRED_AFTER = 8 * 60;
    this.BREAK_DURATION = 30;
    this.CYCLE_LIMIT = cycle === "70-hour" ? 70 * 60 : 60 * 60;
    this.CYCLE_DAYS = cycle === "70-hour" ? 8 : 7;
    this.RESTART_HOURS = 34 * 60;

    this.enableSleeperBerth = options.enableSleeperBerth !== false;
    this.enableAdverseDriving = options.enableAdverseDriving !== false;
    this.shortHaulExemption = options.shortHaulExemption || false;
    this.passengerCarrying = options.passengerCarrying || false;

    this.SLEEPER_FIRST_PERIOD = 7 * 60;
    this.SLEEPER_SECOND_PERIOD = 2 * 60;
  }

  /**
   * Нормализует event коды для поддержки различных форматов FMCSA
   * Преобразует комбинации eventType + eventCode в единые логические коды
   *
   * @param {Object} log - Лог событие с eventType и eventCode
   * @returns {Object} Объект с нормализованными свойствами
   */
  normalizeEventCode(log) {
    const eventType = log.eventType || 1; // По умолчанию Duty Status Change
    const eventCode = log.eventCode;

    // eventType: 1 - Duty Status Change
    if (eventType === 1) {
      // 1: OFF, 2: SB, 3: D, 4: ON
      return {
        isDriving: eventCode === 3,
        isOnDuty: eventCode === 3 || eventCode === 4 || eventCode === 5,
        isRest: eventCode === 1 || eventCode === 2,
        canResetBreak: eventCode === 1 || eventCode === 2,
        normalizedCode: eventCode,
      };
    }

    // eventType: 3 - Special Events
    if (eventType === 3) {
      if (eventCode === 1) {
        // Personal Conveyance (PC)
        return {
          isDriving: false,
          isOnDuty: false,
          isRest: false,
          canResetBreak: true, // PC сбрасывает счетчик перерыва
          normalizedCode: 6, // PC = 6
        };
      } else if (eventCode === 2) {
        // Yard Move (YM)
        return {
          isDriving: false,
          isOnDuty: true, // YM учитывается как On-Duty
          isRest: false,
          canResetBreak: false,
          normalizedCode: 5, // YM = 5
        };
      }
    }

    // Fallback для неизвестных кодов
    return {
      isDriving: false,
      isOnDuty: false,
      isRest: false,
      canResetBreak: false,
      normalizedCode: eventCode,
    };
  }

  calculate(logs, currentTime = Date.now(), adverseConditions = false) {
    if (!logs || logs.length === 0) {
      return this.getDefaultStatus();
    }

    const sortedLogs = [...logs].sort((a, b) => a.timestamp - b.timestamp);

    const effectiveDrivingLimit =
      adverseConditions && this.enableAdverseDriving
        ? this.DRIVING_LIMIT + 120
        : this.DRIVING_LIMIT;

    const lastRestPeriod = this.enableSleeperBerth
      ? this.findLastRestPeriodWithSleeper(sortedLogs, currentTime)
      : this.findLastRestPeriod(sortedLogs, currentTime);

    const currentShift = this.calculateCurrentShift(
      sortedLogs,
      lastRestPeriod,
      currentTime,
    );
    const cycleData = this.calculateCycleTime(sortedLogs, currentTime);
    const restartAvailable = this.check34HourRestart(sortedLogs, currentTime);
    const violations = this.findViolations(
      sortedLogs,
      currentShift,
      cycleData,
      effectiveDrivingLimit,
    );

    return {
      currentStatus: this.getCurrentStatus(sortedLogs, currentTime),
      shift: {
        drivingTime: currentShift.drivingTime,
        onDutyTime: currentShift.onDutyTime,
        elapsedTime: currentShift.elapsedTime,
        remainingDriveTime: Math.max(
          0,
          effectiveDrivingLimit - currentShift.drivingTime,
        ),
        remainingOnDutyTime: Math.max(
          0,
          this.ON_DUTY_LIMIT - currentShift.elapsedTime,
        ),
        shiftStartTime: lastRestPeriod.endTime,
        timeUntilBreak: this.calculateTimeUntilBreak(
          sortedLogs,
          lastRestPeriod,
          currentTime,
        ),
        sleeperBerthUsed: lastRestPeriod.sleeperBerthUsed || false,
      },
      cycle: {
        totalTime: cycleData.totalTime,
        remainingTime: Math.max(0, this.CYCLE_LIMIT - cycleData.totalTime),
        cycleDays: this.CYCLE_DAYS,
        cycleLimit: this.CYCLE_LIMIT,
        periodStart: cycleData.periodStart,
        periodEnd: cycleData.periodEnd,
      },
      restart: {
        available: restartAvailable.available,
        hoursCompleted: restartAvailable.hoursCompleted,
        timeRemaining: restartAvailable.timeRemaining,
      },
      violations: violations,
      adverseConditions: adverseConditions,
      timestamp: currentTime,
    };
  }

  findLastRestPeriodWithSleeper(logs, currentTime) {
    const regularRest = this.findLastRestPeriod(logs, currentTime);
    const sleeperRest = this.findSplitSleeperBerth(logs, currentTime);

    if (sleeperRest && sleeperRest.endTime > regularRest.endTime) {
      return { ...sleeperRest, sleeperBerthUsed: true };
    }

    return regularRest;
  }

  findSplitSleeperBerth(logs, currentTime) {
    const sleeperPeriods = [];

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];

      if (log.eventCode === 2) {
        const nextLog =
          i < logs.length - 1 ? logs[i + 1] : { timestamp: currentTime };
        const duration = (nextLog.timestamp - log.timestamp) / 60000;

        if (duration >= this.SLEEPER_SECOND_PERIOD) {
          sleeperPeriods.push({
            startTime: log.timestamp,
            endTime: nextLog.timestamp,
            duration: duration,
          });
        }
      }
    }

    if (sleeperPeriods.length >= 2) {
      const last = sleeperPeriods[sleeperPeriods.length - 1];
      const beforeLast = sleeperPeriods[sleeperPeriods.length - 2];

      const totalDuration = last.duration + beforeLast.duration;

      const validSplit =
        (last.duration >= this.SLEEPER_FIRST_PERIOD ||
          beforeLast.duration >= this.SLEEPER_FIRST_PERIOD) &&
        last.duration >= this.SLEEPER_SECOND_PERIOD &&
        beforeLast.duration >= this.SLEEPER_SECOND_PERIOD &&
        totalDuration >= 10 * 60;

      if (validSplit) {
        return {
          startTime: beforeLast.startTime,
          endTime: beforeLast.endTime,
          duration: totalDuration,
          splitPeriods: [beforeLast, last],
        };
      }
    }

    return null;
  }

  findLastRestPeriod(logs, currentTime) {
    let restStart = null;
    let totalRest = 0;

    for (let i = logs.length - 1; i >= 0; i--) {
      const log = logs[i];
      const nextLog =
        i < logs.length - 1 ? logs[i + 1] : { timestamp: currentTime };

      const duration = (nextLog.timestamp - log.timestamp) / 60000;

      if (log.eventCode === 1 || log.eventCode === 2) {
        if (restStart === null) {
          restStart = log.timestamp;
        }
        totalRest += duration;

        if (totalRest >= 10 * 60) {
          return {
            startTime: log.timestamp,
            endTime: nextLog.timestamp,
            duration: totalRest,
          };
        }
      } else {
        restStart = null;
        totalRest = 0;
      }
    }

    return {
      startTime: logs[0].timestamp,
      endTime: logs[0].timestamp,
      duration: 0,
    };
  }

  calculateCurrentShift(logs, lastRestPeriod, currentTime) {
    let drivingTime = 0;
    let onDutyTime = 0;
    let elapsedTime = 0;

    const shiftLogs = logs.filter(
      (log) => log.timestamp >= lastRestPeriod.endTime,
    );

    for (let i = 0; i < shiftLogs.length; i++) {
      const log = shiftLogs[i];
      const nextLog =
        i < shiftLogs.length - 1
          ? shiftLogs[i + 1]
          : { timestamp: currentTime };

      const duration = (nextLog.timestamp - log.timestamp) / 60000;

      // Используем нормализацию для поддержки всех форматов
      const normalized = this.normalizeEventCode(log);

      if (normalized.isDriving) {
        drivingTime += duration;
        onDutyTime += duration;
      } else if (normalized.isOnDuty) {
        // YM (eventType: 3, eventCode: 2) и ON (eventCode: 4, 5)
        onDutyTime += duration;
      }

      if (i === 0) {
        elapsedTime = (currentTime - log.timestamp) / 60000;
      }
    }

    return {
      drivingTime: Math.round(drivingTime),
      onDutyTime: Math.round(onDutyTime),
      elapsedTime: Math.round(elapsedTime),
    };
  }

  calculateCycleTime(logs, currentTime) {
    const cyclePeriodMs = this.CYCLE_DAYS * 24 * 60 * 60 * 1000;
    const periodStart = currentTime - cyclePeriodMs;

    let totalTime = 0;
    const cycleLogs = logs.filter((log) => log.timestamp >= periodStart);

    for (let i = 0; i < cycleLogs.length; i++) {
      const log = cycleLogs[i];
      const nextLog =
        i < cycleLogs.length - 1
          ? cycleLogs[i + 1]
          : { timestamp: currentTime };

      const duration = (nextLog.timestamp - log.timestamp) / 60000;

      // Используем нормализацию для поддержки всех форматов
      const normalized = this.normalizeEventCode(log);

      if (normalized.isDriving || normalized.isOnDuty) {
        // D, ON, YM учитываются в цикле
        totalTime += duration;
      }
    }

    return {
      totalTime: Math.round(totalTime),
      periodStart: periodStart,
      periodEnd: currentTime,
    };
  }

  calculateTimeUntilBreak(logs, lastRestPeriod, currentTime) {
    let drivingTime = 0;
    let lastBreakEnd = lastRestPeriod.endTime;

    const shiftLogs = logs.filter(
      (log) => log.timestamp >= lastRestPeriod.endTime,
    );

    for (let i = 0; i < shiftLogs.length; i++) {
      const log = shiftLogs[i];
      const nextLog =
        i < shiftLogs.length - 1
          ? shiftLogs[i + 1]
          : { timestamp: currentTime };

      const duration = (nextLog.timestamp - log.timestamp) / 60000;

      const normalized = this.normalizeEventCode(log);

      if (normalized.isDriving) {
        drivingTime += duration;
      } else if (normalized.canResetBreak && duration >= this.BREAK_DURATION) {
        // OFF, SB, и PC сбрасывают счетчик перерыва
        drivingTime = 0;
        lastBreakEnd = nextLog.timestamp;
      }
    }

    const remaining = this.BREAK_REQUIRED_AFTER - drivingTime;
    return remaining > 0 ? Math.round(remaining) : 0;
  }

  check34HourRestart(logs, currentTime) {
    let restStart = null;
    let totalRest = 0;

    for (let i = logs.length - 1; i >= 0; i--) {
      const log = logs[i];
      const nextLog =
        i < logs.length - 1 ? logs[i + 1] : { timestamp: currentTime };

      const duration = (nextLog.timestamp - log.timestamp) / 60000;

      if (log.eventCode === 1 || log.eventCode === 2) {
        if (restStart === null) {
          restStart = log.timestamp;
        }
        totalRest += duration;

        if (totalRest >= this.RESTART_HOURS) {
          return {
            available: true,
            hoursCompleted: Math.round(totalRest / 60),
            timeRemaining: 0,
          };
        }
      } else {
        if (restStart !== null) {
          const remaining = this.RESTART_HOURS - totalRest;
          return {
            available: false,
            hoursCompleted: Math.round(totalRest / 60),
            timeRemaining: Math.round(remaining),
          };
        }
      }
    }

    return {
      available: false,
      hoursCompleted: Math.round(totalRest / 60),
      timeRemaining: Math.round(this.RESTART_HOURS - totalRest),
    };
  }

  findViolations(logs, currentShift, cycleData, effectiveDrivingLimit) {
    const violations = [];

    if (currentShift.drivingTime > effectiveDrivingLimit) {
      const limit = effectiveDrivingLimit / 60;
      violations.push({
        type: "DRIVING_LIMIT",
        message: `Driving limit exceeded: ${Math.round(currentShift.drivingTime / 60)}h of ${limit}h`,
        severity: "critical",
      });
    }

    if (currentShift.elapsedTime > this.ON_DUTY_LIMIT) {
      violations.push({
        type: "ON_DUTY_LIMIT",
        message: `Shift limit exceeded: ${Math.round(currentShift.elapsedTime / 60)}h of 14h`,
        severity: "critical",
      });
    }

    if (cycleData.totalTime > this.CYCLE_LIMIT) {
      violations.push({
        type: "CYCLE_LIMIT",
        message: `Cycle limit exceeded: ${Math.round(cycleData.totalTime / 60)}h of ${this.CYCLE_LIMIT / 60}h`,
        severity: "critical",
      });
    }

    const breakViolation = this.checkBreakViolation(logs, currentShift);
    if (breakViolation) {
      violations.push(breakViolation);
    }

    return violations;
  }

  checkBreakViolation(logs) {
    let continuousDriving = 0;
    let lastBreakTime = 0;
    let hasViolation = false;

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      const nextLog = i < logs.length - 1 ? logs[i + 1] : null;

      if (!nextLog) break;

      const duration = (nextLog.timestamp - log.timestamp) / 60000;
      const normalized = this.normalizeEventCode(log);

      if (normalized.isDriving) {
        continuousDriving += duration;

        if (
          continuousDriving > this.BREAK_REQUIRED_AFTER &&
          lastBreakTime === 0
        ) {
          hasViolation = true;
        }
      } else if (normalized.canResetBreak && duration >= this.BREAK_DURATION) {
        // OFF, SB, PC сбрасывают счетчик перерыва
        continuousDriving = 0;
        lastBreakTime = log.timestamp;
        hasViolation = false;
      }
    }

    if (hasViolation) {
      return {
        type: "BREAK_REQUIRED",
        message: `30-minute break required after 8 hours of driving`,
        severity: "warning",
      };
    }

    return null;
  }

  getCurrentStatus(logs, currentTime) {
    if (logs.length === 0) return { code: 1, name: "OFF" };

    const lastLog = logs[logs.length - 1];
    const normalized = this.normalizeEventCode(lastLog);

    // Маппинг normalized кодов на имена
    const statusMap = {
      1: "OFF",
      2: "SB",
      3: "D",
      4: "ON",
      5: "YM", // Yard Move
      6: "PC", // Personal Conveyance
    };

    return {
      code: normalized.normalizedCode,
      name: statusMap[normalized.normalizedCode] || "UNKNOWN",
      since: lastLog.timestamp,
      duration: Math.round((currentTime - lastLog.timestamp) / 60000),
    };
  }

  getDefaultStatus() {
    return {
      currentStatus: { code: 1, name: "OFF", since: null, duration: 0 },
      shift: {
        drivingTime: 0,
        onDutyTime: 0,
        elapsedTime: 0,
        remainingDriveTime: this.DRIVING_LIMIT,
        remainingOnDutyTime: this.ON_DUTY_LIMIT,
        shiftStartTime: null,
        timeUntilBreak: this.BREAK_REQUIRED_AFTER,
      },
      cycle: {
        totalTime: 0,
        remainingTime: this.CYCLE_LIMIT,
        cycleDays: this.CYCLE_DAYS,
        cycleLimit: this.CYCLE_LIMIT,
        periodStart: null,
        periodEnd: null,
      },
      restart: {
        available: false,
        hoursCompleted: 0,
        timeRemaining: this.RESTART_HOURS,
      },
      violations: [],
      timestamp: Date.now(),
    };
  }

  static formatMinutes(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
  }

  static formatMinutesToString(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}:${mins.toString().padStart(2, "0")}`;
  }
}

class LogbookAdapter {
  constructor(fieldMapping = null) {
    this.defaultMapping = {
      eventType: "event_type",
      eventCode: "event_code",
      datetime: "datetime",
      eventRecordStatus: "event_record_status",
      eventRecordOrigin: "event_record_origin",
      driverId: "driver_id",
      coDriverId: "co_driver_id",
      vehicleId: "vehicle_id",
      accumulatedVehicleMiles: "accumulated_vehicle_miles",
      latitude: "latitude",
      longitude: "longitude",
      locationDescription: "driver_location_description",
      comment: "comment",
      deletedAt: "deleted_at",
      validEventTypes: [1, 3],
      activeRecordStatus: 1,
    };

    this.mapping = fieldMapping
      ? { ...this.defaultMapping, ...fieldMapping }
      : this.defaultMapping;
  }

  getFieldValue(log, mappingKey) {
    const fieldPath = this.mapping[mappingKey];

    if (!fieldPath) return null;

    if (typeof fieldPath === "string" && fieldPath.includes(".")) {
      return fieldPath.split(".").reduce((obj, key) => obj?.[key], log);
    }

    if (typeof fieldPath === "function") {
      return fieldPath(log);
    }

    return log[fieldPath];
  }

  convertToHOSFormat(logbookData, driverId = null) {
    let filteredLogs = logbookData;

    if (driverId !== null) {
      filteredLogs = filteredLogs.filter(
        (log) => this.getFieldValue(log, "driverId") === driverId,
      );
    }

    const validEventTypes = this.mapping.validEventTypes;
    const activeRecordStatus = this.mapping.activeRecordStatus;

    filteredLogs = filteredLogs.filter((log) => {
      const eventType = this.getFieldValue(log, "eventType");
      const recordStatus = this.getFieldValue(log, "eventRecordStatus");
      const deletedAt = this.getFieldValue(log, "deletedAt");

      return (
        validEventTypes.includes(eventType) &&
        recordStatus === activeRecordStatus &&
        deletedAt === null
      );
    });

    const hosLogs = filteredLogs.map((log) => {
      const datetime = this.getFieldValue(log, "datetime");
      const timestamp = datetime ? new Date(datetime).getTime() : null;

      return {
        eventType: this.getFieldValue(log, "eventType"),
        eventCode: this.getFieldValue(log, "eventCode"),
        timestamp: timestamp,
        eventRecordStatus: this.getFieldValue(log, "eventRecordStatus"),
        eventRecordOrigin: this.getFieldValue(log, "eventRecordOrigin"),
        accumulatedVehicleMiles: this.getFieldValue(
          log,
          "accumulatedVehicleMiles",
        ),
        location: {
          latitude: this.getFieldValue(log, "latitude"),
          longitude: this.getFieldValue(log, "longitude"),
          description: this.getFieldValue(log, "locationDescription"),
        },
        driverId: this.getFieldValue(log, "driverId"),
        coDriverId: this.getFieldValue(log, "coDriverId"),
        vehicleId: this.getFieldValue(log, "vehicleId"),
        comment: this.getFieldValue(log, "comment"),
        _original: log,
      };
    });

    const validLogs = hosLogs.filter(
      (log) => log.timestamp && !isNaN(log.timestamp),
    );

    validLogs.sort((a, b) => a.timestamp - b.timestamp);

    return validLogs;
  }

  getDriverIds(logbookData) {
    const driverIds = new Set();
    logbookData.forEach((log) => {
      const driverId = this.getFieldValue(log, "driverId");
      if (driverId) driverIds.add(driverId);
    });
    return Array.from(driverIds);
  }

  getLogsByDateRange(logbookData, startDate, endDate, driverId = null) {
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();

    const filtered = logbookData.filter((log) => {
      const datetime = this.getFieldValue(log, "datetime");
      const logTime = new Date(datetime).getTime();
      const matchesDate = logTime >= start && logTime <= end;
      const matchesDriver =
        !driverId || this.getFieldValue(log, "driverId") === driverId;
      return matchesDate && matchesDriver;
    });

    return this.convertToHOSFormat(filtered, driverId);
  }

  static createFromConfig(config) {
    return new LogbookAdapter(config);
  }
}

function formatHOSResultToJSON(result) {
  const breakUsed = result.shift.drivingTime;
  const breakLimit = 8 * 60;
  const breakPercentage = Math.min(
    100,
    Math.round((breakUsed / breakLimit) * 100),
  );

  const driveUsed = result.shift.drivingTime;
  const driveLimit = 11 * 60;
  const drivePercentage = Math.min(
    100,
    Math.round((driveUsed / driveLimit) * 100),
  );

  const shiftElapsed = result.shift.elapsedTime;
  const shiftLimit = 14 * 60;
  const shiftPercentage = Math.min(
    100,
    Math.round((shiftElapsed / shiftLimit) * 100),
  );

  const cycleUsed = result.cycle.totalTime;
  const cycleLimit = result.cycle.cycleLimit;
  const cyclePercentage = Math.min(
    100,
    Math.round((cycleUsed / cycleLimit) * 100),
  );

  return {
    break: HOSCalculator.formatMinutesToString(result.shift.timeUntilBreak),
    break_percentage: breakPercentage,
    drive: HOSCalculator.formatMinutesToString(result.shift.remainingDriveTime),
    drive_percentage: drivePercentage,
    shift: HOSCalculator.formatMinutesToString(
      result.shift.remainingOnDutyTime,
    ),
    shift_percentage: shiftPercentage,
    cycle: HOSCalculator.formatMinutesToString(result.cycle.remainingTime),
    cycle_percentage: cyclePercentage,
    status: result.currentStatus.name,
    violations: result.violations.map((v) => ({
      type: v.type,
      severity: v.severity,
      message: v.message,
    })),
  };
}

function processLogbook(
  filePath = "logbook.json",
  customMapping = null,
  options = {},
) {
  try {
    const { jsonFormat = false, silent = false } = options;

    if (!silent) {
      console.log("=== HOS Calculator for Node.js ===\n");
    }

    const fileContent = fs.readFileSync(filePath, "utf8");
    const logbookData = JSON.parse(fileContent);

    if (!silent) {
      console.log("✓ Logbook loaded");
      console.log(`  Total records: ${logbookData.length}\n`);
    }

    const adapter = customMapping
      ? new LogbookAdapter(customMapping)
      : new LogbookAdapter();

    const calculator = new HOSCalculator("70-hour", {
      enableSleeperBerth: true,
      enableAdverseDriving: true,
    });

    const driverIds = adapter.getDriverIds(logbookData);

    if (!silent) {
      console.log(`✓ Drivers found: ${driverIds.length}`);
      console.log(`  IDs: ${driverIds.join(", ")}\n`);
    }

    const results = {};

    for (const driverId of driverIds) {
      const hosLogs = adapter.convertToHOSFormat(logbookData, driverId);

      if (hosLogs.length === 0) continue;

      const result = calculator.calculate(hosLogs);

      if (jsonFormat) {
        results[driverId] = formatHOSResultToJSON(result);
      } else {
        results[driverId] = result;
      }
    }

    if (jsonFormat && !silent) {
      console.log(JSON.stringify(results, null, 2));
    }

    return results;
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

module.exports = {
  HOSCalculator,
  LogbookAdapter,
  processLogbook,
  formatHOSResultToJSON,
};

if (require.main === module) {
  const filePath = process.argv[2] || "logbook.json";
  processLogbook(filePath);
}
