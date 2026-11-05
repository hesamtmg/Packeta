import {
  effectiveRailScheduleTimes,
  isInstantRail,
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

  it('instant rails (POL_PAY, BANK_TRANSFER) never resolve to a schedule, even with an override', () => {
    for (const rail of [
      SettlementRailType.POL_PAY,
      SettlementRailType.BANK_TRANSFER,
    ]) {
      expect(isInstantRail(rail)).toBe(true);
      expect(effectiveRailScheduleTimes(rail, null)).toBeNull();
      expect(effectiveRailScheduleTimes(rail, ['11:15'])).toBeNull();
    }
  });

  it('PAYA and SATNA are scheduled rails', () => {
    expect(isInstantRail(SettlementRailType.PAYA)).toBe(false);
    expect(isInstantRail(SettlementRailType.SATNA)).toBe(false);
    expect(isInstantRail(null)).toBe(false);
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
