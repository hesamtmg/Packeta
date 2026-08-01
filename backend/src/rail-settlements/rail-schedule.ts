import { SettlementRailType } from './entities/rail-settlement.entity';

// Built-in "HH:MM" (server-local) processing windows per rail, used when a
// wallet doesn't set its own railScheduleTimes override. Approximate,
// sandbox-grade values modeling how each rail actually behaves in Iran —
// not sourced from a live CBI/Shaparak schedule:
//   - POL_PAY: a real-time-ish PSP bridge, so it gets a dense hourly
//     schedule rather than a genuinely time-independent "any minute" path —
//     keeps every rail on the same "list of times" model instead of a
//     special-cased instant one.
//   - PAYA: CBI's batch clearing settles a handful of times a day.
//   - SATNA: CBI's RTGS, available through the business day but cuts off
//     mid-afternoon.
//   - BANK_TRANSFER: no default — timing is entirely bank-specific, so a
//     wallet choosing this rail must supply its own railScheduleTimes (see
//     WalletsService validation).
export const RAIL_DEFAULT_SCHEDULE_TIMES: Record<
  SettlementRailType,
  string[] | null
> = {
  [SettlementRailType.POL_PAY]: [
    '00:00',
    '01:00',
    '02:00',
    '03:00',
    '04:00',
    '05:00',
    '06:00',
    '07:00',
    '08:00',
    '09:00',
    '10:00',
    '11:00',
    '12:00',
    '13:00',
    '14:00',
    '15:00',
    '16:00',
    '17:00',
    '18:00',
    '19:00',
    '20:00',
    '21:00',
    '22:00',
    '23:00',
  ],
  [SettlementRailType.PAYA]: ['09:00', '11:00', '13:00', '15:00'],
  [SettlementRailType.SATNA]: ['08:30', '10:30', '12:30', '14:30'],
  [SettlementRailType.BANK_TRANSFER]: null,
};

// The times a wallet actually sweeps at for its configured rail: its own
// override when set, otherwise the rail's built-in default.
export function effectiveRailScheduleTimes(
  railType: SettlementRailType,
  override: string[] | null | undefined,
): string[] | null {
  return override?.length ? override : RAIL_DEFAULT_SCHEDULE_TIMES[railType];
}
