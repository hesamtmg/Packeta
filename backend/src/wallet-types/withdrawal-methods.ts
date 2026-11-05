import { SettlementRailType } from '../rail-settlements/entities/rail-settlement.entity';

// A merchant-style wallet type's (supportsAutoWithdraw) payout methods: one
// entry per interbank rail (Pol Pay / Paya / Satna / bank transfer) the
// super admin configures when creating or editing the type. Stored as
// WalletType.withdrawalMethods (jsonb).
//
//   - enabled: whether a merchant wallet of this type may pick this rail at
//     all (see WalletsController's rail checks).
//   - feePercent + fixedFee: what a single payout over this rail costs —
//     feePercent of the payout's amount (floored to a whole minor unit) plus
//     a flat fixedFee in minor units, capped at the payout's own amount. The
//     merchant's bank receives the amount minus that fee.
//   - feeRepositoryWalletId: the MERCHANT_REPOSITORY-type wallet (same
//     currency) the fee is transferred into. Required whenever the rail has
//     any fee at all — see WalletTypesService.validateWithdrawalMethods.
//
// A type with no withdrawalMethods configured (null / empty) keeps the
// original behavior: every rail selectable, no fee.
export interface WithdrawalMethodConfig {
  railType: SettlementRailType;
  enabled: boolean;
  // Numeric string, 0-100 with up to 3 decimal places (same convention as
  // WalletType.feePercent).
  feePercent: string;
  // Minor units, as a bigint string.
  fixedFee: string;
  feeRepositoryWalletId: string | null;
}

export function findWithdrawalMethod(
  methods: WithdrawalMethodConfig[] | null | undefined,
  railType: SettlementRailType | null | undefined,
): WithdrawalMethodConfig | null {
  if (!railType || !methods?.length) return null;
  return methods.find((method) => method.railType === railType) ?? null;
}

// Whether a merchant wallet of a type with these methods may select
// railType. Unconfigured types allow every rail (legacy behavior); a
// configured type only allows the rails it explicitly enables.
export function isRailEnabled(
  methods: WithdrawalMethodConfig[] | null | undefined,
  railType: SettlementRailType,
): boolean {
  if (!methods?.length) return true;
  return !!findWithdrawalMethod(methods, railType)?.enabled;
}

// The fee one payout of `amount` over `method` costs, in minor units:
// floor(amount * feePercent / 100) + fixedFee, never more than the amount
// itself. feePercent is converted to an integer number of thousandths of a
// percent first so the arithmetic stays in bigint (no float rounding).
export function computeWithdrawalFee(
  method: WithdrawalMethodConfig | null,
  amount: bigint,
): bigint {
  if (!method || amount <= 0n) return 0n;
  const milliPercent = BigInt(
    Math.round(Number(method.feePercent || 0) * 1000),
  );
  const percentPart = (amount * milliPercent) / 100000n;
  const fee = percentPart + BigInt(method.fixedFee || '0');
  if (fee <= 0n) return 0n;
  return fee > amount ? amount : fee;
}

export function hasAnyFee(method: {
  feePercent?: number | string | null;
  fixedFee?: number | string | null;
}): boolean {
  return Number(method.feePercent ?? 0) > 0 || Number(method.fixedFee ?? 0) > 0;
}
