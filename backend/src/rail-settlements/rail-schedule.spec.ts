import {
  effectiveRailScheduleTimes,
  RAIL_DEFAULT_SCHEDULE_TIMES,
} from './rail-schedule';
import { SettlementRailType } from './entities/rail-settlement.entity';

describe('effectiveRailScheduleTimes', () => {
  it('uses a wallet-supplied override when present', () => {
    expect(
      effectiveRailScheduleTimes(SettlementRailType.PAYA, ['06:00']),
    ).toEqual(['06:00']);
  });

  it('falls back to the rail default when no override is set', () => {
    expect(effectiveRailScheduleTimes(SettlementRailType.PAYA, null)).toEqual(
      RAIL_DEFAULT_SCHEDULE_TIMES[SettlementRailType.PAYA],
    );
    expect(
      effectiveRailScheduleTimes(SettlementRailType.PAYA, undefined),
    ).toEqual(RAIL_DEFAULT_SCHEDULE_TIMES[SettlementRailType.PAYA]);
  });

  it('falls back to the rail default for an empty override array', () => {
    expect(effectiveRailScheduleTimes(SettlementRailType.SATNA, [])).toEqual(
      RAIL_DEFAULT_SCHEDULE_TIMES[SettlementRailType.SATNA],
    );
  });

  it('BANK_TRANSFER has no built-in default — resolves to null with no override', () => {
    expect(
      effectiveRailScheduleTimes(SettlementRailType.BANK_TRANSFER, null),
    ).toBeNull();
    expect(
      effectiveRailScheduleTimes(SettlementRailType.BANK_TRANSFER, ['11:15']),
    ).toEqual(['11:15']);
  });

  it('every rail default entry is a valid "HH:MM" string', () => {
    for (const times of Object.values(RAIL_DEFAULT_SCHEDULE_TIMES)) {
      if (!times) continue;
      for (const time of times) {
        expect(time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      }
    }
  });
});
