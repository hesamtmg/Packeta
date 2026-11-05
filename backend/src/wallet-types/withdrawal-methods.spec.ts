import { SettlementRailType } from '../rail-settlements/entities/rail-settlement.entity';
import {
  computeWithdrawalFee,
  isRailEnabled,
  WithdrawalMethodConfig,
} from './withdrawal-methods';

const method = (
  overrides: Partial<WithdrawalMethodConfig> = {},
): WithdrawalMethodConfig => ({
  railType: SettlementRailType.PAYA,
  enabled: true,
  feePercent: '0',
  fixedFee: '0',
  feeRepositoryWalletId: 'repo-1',
  ...overrides,
});

describe('computeWithdrawalFee', () => {
  it('adds the floored percentage and the fixed fee', () => {
    expect(
      computeWithdrawalFee(method({ feePercent: '1.25', fixedFee: '7' }), 999n),
    ).toBe(12n + 7n); // 1.25% of 999 = 12.4875 -> 12
  });

  it('never exceeds the payout amount', () => {
    expect(computeWithdrawalFee(method({ fixedFee: '500' }), 300n)).toBe(300n);
  });

  it('is zero with no method or no fee', () => {
    expect(computeWithdrawalFee(null, 1000n)).toBe(0n);
    expect(computeWithdrawalFee(method(), 1000n)).toBe(0n);
  });
});

describe('isRailEnabled', () => {
  it('allows every rail when nothing is configured', () => {
    expect(isRailEnabled(null, SettlementRailType.SATNA)).toBe(true);
    expect(isRailEnabled([], SettlementRailType.SATNA)).toBe(true);
  });

  it('only allows rails the type explicitly enables', () => {
    const methods = [
      method({ railType: SettlementRailType.PAYA, enabled: true }),
      method({ railType: SettlementRailType.SATNA, enabled: false }),
    ];
    expect(isRailEnabled(methods, SettlementRailType.PAYA)).toBe(true);
    expect(isRailEnabled(methods, SettlementRailType.SATNA)).toBe(false);
    expect(isRailEnabled(methods, SettlementRailType.POL_PAY)).toBe(false);
  });
});
