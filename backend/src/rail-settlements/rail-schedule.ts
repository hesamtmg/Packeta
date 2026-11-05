import { SettlementRailType } from './entities/rail-settlement.entity';

// Rails split into two settlement modes:
//   - Instant (POL_PAY, BANK_TRANSFER): synchronous transfers. A merchant
//     wallet on one of these rails is paid out the moment each purchase into
//     it completes (see TransactionsService.verifyPurchase ->
//     settleInstantRailIfConfigured) — there is no schedule, so any stored
//     railScheduleTimes are ignored and cleared on save.
//   - Scheduled (PAYA, SATNA): CBI batch/RTGS rails that only settle at
//     fixed windows. Swept by SettlementRailSweepService at the wallet's own
//     "HH:MM" (Tehran time) override, else the rail's built-in default below.
export const INSTANT_RAILS: ReadonlySet<SettlementRailType> = new Set([
  SettlementRailType.POL_PAY,
  SettlementRailType.BANK_TRANSFER,
]);

export function isInstantRail(
  railType: SettlementRailType | null | undefined,
): boolean {
  return !!railType && INSTANT_RAILS.has(railType);
}

// Built-in "HH:MM" processing windows for the scheduled rails, used when a
// wallet doesn't set its own railScheduleTimes override. Approximate,
// sandbox-grade values modeling how each rail behaves in Iran — not sourced
// from a live CBI/Shaparak schedule:
//   - PAYA: CBI's batch clearing settles a handful of times a day.
//   - SATNA: CBI's RTGS, available through the business day but cuts off
//     mid-afternoon.
// Instant rails have no schedule at all (null).
export const RAIL_DEFAULT_SCHEDULE_TIMES: Record<
  SettlementRailType,
  string[] | null
> = {
  [SettlementRailType.POL_PAY]: null,
  [SettlementRailType.PAYA]: ['09:00', '11:00', '13:00', '15:00'],
  [SettlementRailType.SATNA]: ['08:30', '10:30', '12:30', '14:30'],
  [SettlementRailType.BANK_TRANSFER]: null,
};

// The times a wallet actually sweeps at for its configured rail: its own
// override when set, otherwise the rail's built-in default. Always null for
// an instant rail — those settle per purchase, never on the scheduler.
export function effectiveRailScheduleTimes(
  railType: SettlementRailType,
  override: string[] | null | undefined,
): string[] | null {
  if (isInstantRail(railType)) return null;
  return override?.length ? override : RAIL_DEFAULT_SCHEDULE_TIMES[railType];
}
