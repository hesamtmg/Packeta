import { BadRequestException } from '@nestjs/common';
import { SettlementService } from './settlement.service';
import {
  SettlementSplit,
  SettlementSplitType,
} from './entities/settlement-split.entity';

function percentRow(
  percent: number,
  iban = 'GB29NWBK60161331926819',
): SettlementSplit {
  return {
    id: 'row',
    walletId: 'wallet-1',
    transactionId: null,
    iban,
    label: null,
    splitType: SettlementSplitType.PERCENT,
    percentValue: percent.toString(),
    fixedAmount: null,
    sortOrder: 0,
    createdAt: new Date(),
  };
}

function fixedRow(
  amount: number,
  iban = 'GB29NWBK60161331926819',
): SettlementSplit {
  return {
    id: 'row',
    walletId: null,
    transactionId: 'tx-1',
    iban,
    label: null,
    splitType: SettlementSplitType.FIXED,
    percentValue: null,
    fixedAmount: amount.toString(),
    sortOrder: 0,
    createdAt: new Date(),
  };
}

describe('SettlementService.validateWalletDefaults', () => {
  const service = new SettlementService({} as any);

  it('accepts percentages that add up to exactly 100', () => {
    expect(() =>
      service.validateWalletDefaults([
        { iban: 'GB29NWBK60161331926819', percent: 60 },
        { iban: 'GB29NWBK60161331926820', percent: 40 },
      ]),
    ).not.toThrow();
  });

  it('rejects percentages that fall short of 100', () => {
    expect(() =>
      service.validateWalletDefaults([
        { iban: 'GB29NWBK60161331926819', percent: 60 },
        { iban: 'GB29NWBK60161331926820', percent: 30 },
      ]),
    ).toThrow(BadRequestException);
  });

  it('rejects an empty set', () => {
    expect(() => service.validateWalletDefaults([])).toThrow(
      BadRequestException,
    );
  });
});

describe('SettlementService.validateChargeOverrides', () => {
  const service = new SettlementService({} as any);

  it('accepts percent splits summing to exactly 100', () => {
    expect(() =>
      service.validateChargeOverrides(
        [
          { iban: 'GB29NWBK60161331926819', type: 'PERCENT', value: 70 },
          { iban: 'GB29NWBK60161331926820', type: 'PERCENT', value: 30 },
        ],
        1000,
      ),
    ).not.toThrow();
  });

  it('accepts fixed splits summing to exactly the charge amount', () => {
    expect(() =>
      service.validateChargeOverrides(
        [
          { iban: 'GB29NWBK60161331926819', type: 'FIXED', value: 600 },
          { iban: 'GB29NWBK60161331926820', type: 'FIXED', value: 400 },
        ],
        1000,
      ),
    ).not.toThrow();
  });

  it('rejects fixed splits that do not add up to the exact amount', () => {
    expect(() =>
      service.validateChargeOverrides(
        [
          { iban: 'GB29NWBK60161331926819', type: 'FIXED', value: 600 },
          { iban: 'GB29NWBK60161331926820', type: 'FIXED', value: 300 },
        ],
        1000,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects mixed PERCENT and FIXED within the same charge', () => {
    expect(() =>
      service.validateChargeOverrides(
        [
          { iban: 'GB29NWBK60161331926819', type: 'PERCENT', value: 50 },
          { iban: 'GB29NWBK60161331926820', type: 'FIXED', value: 500 },
        ],
        1000,
      ),
    ).toThrow(BadRequestException);
  });
});

describe('SettlementService.computeAmounts', () => {
  const service = new SettlementService({} as any);

  it('splits a fixed set using the stored amounts directly', () => {
    const amounts = service.computeAmounts(
      [fixedRow(600), fixedRow(400, 'GB29NWBK60161331926820')],
      '1000',
    );
    expect(amounts.map((a) => a.amount)).toEqual([600n, 400n]);
  });

  it('splits a percent set so the pieces always sum to exactly the total, remainder on the last item', () => {
    // 33.33 / 33.33 / 33.34 of 100 — a classic case where naive per-item
    // rounding could lose or gain a unit.
    const amounts = service.computeAmounts(
      [
        percentRow(33.333, 'A'),
        percentRow(33.333, 'B'),
        percentRow(33.334, 'C'),
      ],
      '100',
    );
    const total = amounts.reduce((sum, a) => sum + a.amount, 0n);
    expect(total).toBe(100n);
  });

  it('handles a two-way 60/40 percent split of an odd amount exactly', () => {
    const amounts = service.computeAmounts(
      [percentRow(60, 'A'), percentRow(40, 'B')],
      '2501',
    );
    const total = amounts.reduce((sum, a) => sum + a.amount, 0n);
    expect(total).toBe(2501n);
    expect(amounts[0].amount).toBe(1500n);
    expect(amounts[1].amount).toBe(1001n);
  });
});
