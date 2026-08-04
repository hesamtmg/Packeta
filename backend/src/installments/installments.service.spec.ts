import { InstallmentsService } from './installments.service';
import { InstallmentStatus } from './entities/installment.entity';

function buildService(options: {
  wallets?: any[];
  // walletId -> periodEnd ("YYYY-MM-DD") -> already-generated rows for that
  // batch, mirroring the { walletId, periodEnd } lookup generateDue uses to
  // skip a period it's already generated.
  existingByWalletAndPeriodEnd?: Record<string, Record<string, any[]>>;
  overdueRows?: any[];
  // walletId -> the SUM(t.amount) generateDue's raw query would return for
  // that wallet's VIRTUAL transactions within the collection window.
  virtualSumByWallet?: Record<string, string>;
  // walletId -> the draw-down VIRTUAL rows getSpendBreakdown's query would
  // return (fromWalletId = that wallet) within the collection window.
  drawDownsByWallet?: Record<string, any[]>;
  // transaction id -> row, for getSpendBreakdown's purchase lookup.
  transactionsById?: Record<string, any>;
  // wallet id -> row, for getSpendBreakdown's merchant wallet lookup.
  walletsById?: Record<string, any>;
  // user id -> row, for getSpendBreakdown's merchant user lookup.
  usersById?: Record<string, any>;
}) {
  const installmentsRepository = {
    find: jest.fn(
      async ({ where: { walletId, periodEnd } }: any) =>
        options.existingByWalletAndPeriodEnd?.[walletId]?.[periodEnd] ?? [],
    ),
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (data: any) => ({ id: 'installment-1', ...data })),
    createQueryBuilder: jest.fn(() => ({
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => options.overdueRows ?? []),
    })),
  };
  const walletsRepository = {
    update: jest.fn(async () => undefined),
    findOne: jest.fn(
      async ({ where: { id } }: any) => options.walletsById?.[id] ?? null,
    ),
    createQueryBuilder: jest.fn(() => ({
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => options.wallets ?? []),
    })),
  };
  let lastWalletIdQueried: string | undefined;
  const transactionsRepository = {
    findOne: jest.fn(
      async ({ where: { id } }: any) => options.transactionsById?.[id] ?? null,
    ),
    createQueryBuilder: jest.fn(() => {
      const builder: any = {
        select: jest.fn(() => builder),
        where: jest.fn((_cond: string, params: any) => {
          if (params?.walletId) lastWalletIdQueried = params.walletId;
          return builder;
        }),
        andWhere: jest.fn((_cond: string, params: any) => {
          if (params?.walletId) lastWalletIdQueried = params.walletId;
          return builder;
        }),
        orderBy: jest.fn(() => builder),
        getRawOne: jest.fn(async () => ({
          total: options.virtualSumByWallet?.[lastWalletIdQueried!] ?? '0',
        })),
        getMany: jest.fn(
          async () => options.drawDownsByWallet?.[lastWalletIdQueried!] ?? [],
        ),
      };
      return builder;
    }),
  };
  const usersService = {
    findById: jest.fn(async (id: string) => options.usersById?.[id] ?? null),
  };
  const loggingService = {
    log: jest.fn(async () => undefined),
  };
  const service = new InstallmentsService(
    installmentsRepository as any,
    walletsRepository as any,
    transactionsRepository as any,
    usersService as any,
    loggingService as any,
  );
  return {
    service,
    installmentsRepository,
    walletsRepository,
    transactionsRepository,
    usersService,
    loggingService,
  };
}

describe('InstallmentsService.computeInstallmentPrincipal', () => {
  const { service } = buildService({});

  it('splits evenly when the amount divides cleanly', () => {
    expect(service.computeInstallmentPrincipal(1000n, 4, 1)).toBe(250n);
    expect(service.computeInstallmentPrincipal(1000n, 4, 4)).toBe(250n);
  });

  it('folds the remainder into the last installment only', () => {
    // 1000 / 3 = 333 remainder 1
    expect(service.computeInstallmentPrincipal(1000n, 3, 1)).toBe(333n);
    expect(service.computeInstallmentPrincipal(1000n, 3, 2)).toBe(333n);
    expect(service.computeInstallmentPrincipal(1000n, 3, 3)).toBe(334n);
  });
});

describe('InstallmentsService.computeRepaymentSplit', () => {
  const { service } = buildService({});

  it('sums principal/fee across installments and recovers penalty as the remainder', () => {
    const installments = [
      { principalAmount: '350', feeAmount: '50', amount: '400' },
      { principalAmount: '250', feeAmount: '30', amount: '300' },
    ] as any;

    expect(service.computeRepaymentSplit(installments)).toEqual({
      principal: 600n,
      fee: 80n,
      penalty: 20n,
    });
  });

  it('returns zero penalty for an installment with no accrued penalty', () => {
    const installments = [
      { principalAmount: '100', feeAmount: '10', amount: '110' },
    ] as any;

    expect(service.computeRepaymentSplit(installments)).toEqual({
      principal: 100n,
      fee: 10n,
      penalty: 0n,
    });
  });

  it('returns all zeros for an empty list', () => {
    expect(service.computeRepaymentSplit([])).toEqual({
      principal: 0n,
      fee: 0n,
      penalty: 0n,
    });
  });
});

describe('InstallmentsService.computeDeadlineDate', () => {
  const { service } = buildService({});

  it("uses the same month when the deadline day hasn't passed yet", () => {
    const dueDate = new Date(2026, 0, 5); // Jan 5
    const deadline = service.computeDeadlineDate(dueDate, 20);
    expect(deadline.getMonth()).toBe(0);
    expect(deadline.getDate()).toBe(20);
  });

  it('rolls into the next month when the deadline day already passed', () => {
    const dueDate = new Date(2026, 0, 25); // Jan 25
    const deadline = service.computeDeadlineDate(dueDate, 5);
    expect(deadline.getMonth()).toBe(1);
    expect(deadline.getDate()).toBe(5);
  });

  it('clamps a deadline day beyond the target month length', () => {
    // Jan 31 due date, deadline day 31: same-month candidate is also Jan 31
    // (not past due date, so it wouldn't roll on that basis alone) — but
    // since it equals dueDate exactly, it rolls into Feb, where day 31
    // clamps down to Feb's actual last day.
    const dueDate = new Date(2026, 0, 31); // Jan 31
    const deadline = service.computeDeadlineDate(dueDate, 31);
    expect(deadline.getMonth()).toBe(1);
    expect(deadline.getDate()).toBe(28); // Feb 2026 has 28 days
  });
});

describe('InstallmentsService.generateDue', () => {
  const wallet = {
    id: 'wallet-1',
    repositoryWalletId: 'repo-1',
    walletType: {
      installmentCount: 3,
      feePercent: '10',
      paymentDeadlineDate: 15,
    },
  };

  it("sums the wallet's own VIRTUAL transactions over the one-month window and splits that total across a full installmentCount batch, spread one month apart", async () => {
    const { service, installmentsRepository } = buildService({
      wallets: [wallet],
      virtualSumByWallet: { 'wallet-1': '900' },
    });

    const today = new Date(2026, 0, 1); // Jan 1, 2026
    const created = await service.generateDue(today);

    expect(created).toHaveLength(3);
    expect(installmentsRepository.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        walletId: 'wallet-1',
        sequenceNumber: 1,
        principalAmount: '300', // 900/3
        feeAmount: '30', // 10% of principal
        amount: '330', // principal 300 + 10% fee (30)
        periodStart: '2025-12-01',
        periodEnd: '2026-01-01',
        dueDate: '2026-01-01',
        deadlineDate: '2026-01-15',
        status: InstallmentStatus.PENDING,
      }),
    );
    expect(installmentsRepository.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sequenceNumber: 2,
        principalAmount: '300',
        dueDate: '2026-02-01',
        deadlineDate: '2026-02-15',
      }),
    );
    expect(installmentsRepository.create).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        sequenceNumber: 3,
        principalAmount: '300',
        dueDate: '2026-03-01',
        deadlineDate: '2026-03-15',
      }),
    );
  });

  it('skips a wallet with no VIRTUAL activity in the collection window', async () => {
    const { service, installmentsRepository } = buildService({
      wallets: [wallet],
      virtualSumByWallet: {},
    });

    const created = await service.generateDue(new Date(2026, 0, 1));

    expect(created).toHaveLength(0);
    expect(installmentsRepository.create).not.toHaveBeenCalled();
  });

  it('skips a wallet that already has a batch generated for a period ending today', async () => {
    const { service, installmentsRepository } = buildService({
      wallets: [wallet],
      virtualSumByWallet: { 'wallet-1': '900' },
      existingByWalletAndPeriodEnd: {
        'wallet-1': { '2026-01-01': [{ sequenceNumber: 1 }] },
      },
    });

    const created = await service.generateDue(new Date(2026, 0, 1));

    expect(created).toHaveLength(0);
    expect(installmentsRepository.create).not.toHaveBeenCalled();
  });
});

describe('InstallmentsService.applyOverduePenalties', () => {
  it('adds 5 days worth of penalty and marks OVERDUE, but does not block when the type has no overdueDaysBeforeBlock set', async () => {
    const row = {
      id: 'installment-1',
      amount: '1000',
      principalAmount: '1000',
      penaltyApplied: false,
      penaltyDaysApplied: 0,
      status: InstallmentStatus.PENDING,
      deadlineDate: '2026-01-15',
      wallet: {
        id: 'wallet-1',
        userId: 'user-1',
        blockedAt: null,
        walletType: { penaltyPercentPerDay: '2', overdueDaysBeforeBlock: null },
      },
    };
    const { service, installmentsRepository, walletsRepository } = buildService(
      { overdueRows: [row] },
    );

    // 5 days past deadline, 2%/day of the 1000 principal = 100
    const count = await service.applyOverduePenalties(new Date(2026, 0, 20));

    expect(count).toBe(1);
    expect(row.amount).toBe('1100');
    expect(row.penaltyDaysApplied).toBe(5);
    expect(row.status).toBe(InstallmentStatus.OVERDUE);
    expect(row.penaltyApplied).toBe(true);
    expect(installmentsRepository.save).toHaveBeenCalledWith(row);
    expect(walletsRepository.update).not.toHaveBeenCalled();
  });

  it('does not block while daysOverdue is still within the type overdueDaysBeforeBlock grace period', async () => {
    const row = {
      id: 'installment-5',
      amount: '1000',
      principalAmount: '1000',
      penaltyApplied: false,
      penaltyDaysApplied: 0,
      status: InstallmentStatus.PENDING,
      deadlineDate: '2026-01-15',
      wallet: {
        id: 'wallet-5',
        userId: 'user-5',
        blockedAt: null,
        walletType: { penaltyPercentPerDay: '2', overdueDaysBeforeBlock: 5 },
      },
    };
    const { service, walletsRepository, loggingService } = buildService({
      overdueRows: [row],
    });

    // Exactly 5 days overdue — at, not past, the 5-day threshold.
    await service.applyOverduePenalties(new Date(2026, 0, 20));

    expect(walletsRepository.update).not.toHaveBeenCalled();
    expect(loggingService.log).not.toHaveBeenCalled();
  });

  it('blocks the wallet and logs an admin notification once daysOverdue exceeds overdueDaysBeforeBlock', async () => {
    const row = {
      id: 'installment-6',
      amount: '1000',
      principalAmount: '1000',
      penaltyApplied: false,
      penaltyDaysApplied: 0,
      status: InstallmentStatus.PENDING,
      deadlineDate: '2026-01-15',
      wallet: {
        id: 'wallet-6',
        userId: 'user-6',
        blockedAt: null,
        walletType: { penaltyPercentPerDay: '2', overdueDaysBeforeBlock: 4 },
      },
    };
    const { service, walletsRepository, loggingService } = buildService({
      overdueRows: [row],
    });

    // 5 days overdue, past the 4-day threshold.
    await service.applyOverduePenalties(new Date(2026, 0, 20));

    expect(walletsRepository.update).toHaveBeenCalledWith(
      'wallet-6',
      expect.objectContaining({ blockedAt: expect.any(Date) }),
    );
    expect(loggingService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'SCHEDULER',
        action: 'installment_overdue_block',
        userId: 'user-6',
        metadata: expect.objectContaining({
          walletId: 'wallet-6',
          daysOverdue: 5,
          overdueDaysBeforeBlock: 4,
        }),
      }),
    );
  });

  it('only charges the additional days owed on a run that follows an earlier one', async () => {
    const row = {
      id: 'installment-3',
      amount: '1040', // already charged 2 days (2 * 20) on an earlier run
      principalAmount: '1000',
      penaltyApplied: true,
      penaltyDaysApplied: 2,
      status: InstallmentStatus.OVERDUE,
      deadlineDate: '2026-01-15',
      wallet: {
        id: 'wallet-3',
        blockedAt: new Date(2026, 0, 17),
        walletType: { penaltyPercentPerDay: '2' },
      },
    };
    const { service } = buildService({ overdueRows: [row] });

    // Now 5 days past deadline — only 3 more days owed, not 5 again.
    await service.applyOverduePenalties(new Date(2026, 0, 20));

    expect(row.amount).toBe('1100');
    expect(row.penaltyDaysApplied).toBe(5);
  });

  it('is a no-op when penalty for every elapsed day was already applied', async () => {
    const row = {
      id: 'installment-4',
      amount: '1100',
      principalAmount: '1000',
      penaltyApplied: true,
      penaltyDaysApplied: 5,
      status: InstallmentStatus.OVERDUE,
      deadlineDate: '2026-01-15',
      wallet: {
        id: 'wallet-4',
        blockedAt: new Date(2026, 0, 17),
        walletType: { penaltyPercentPerDay: '2' },
      },
    };
    const { service, installmentsRepository } = buildService({
      overdueRows: [row],
    });

    const count = await service.applyOverduePenalties(new Date(2026, 0, 20));

    expect(count).toBe(0);
    expect(row.amount).toBe('1100');
    expect(installmentsRepository.save).not.toHaveBeenCalled();
  });

  it('does not re-block a wallet that is already blocked', async () => {
    const row = {
      id: 'installment-2',
      amount: '1000',
      principalAmount: '1000',
      penaltyApplied: false,
      penaltyDaysApplied: 0,
      status: InstallmentStatus.PENDING,
      deadlineDate: '2026-01-15',
      wallet: {
        id: 'wallet-2',
        blockedAt: new Date(2026, 0, 10),
        walletType: { penaltyPercentPerDay: '2' },
      },
    };
    const { service, walletsRepository } = buildService({
      overdueRows: [row],
    });

    await service.applyOverduePenalties(new Date(2026, 0, 20));

    expect(walletsRepository.update).not.toHaveBeenCalled();
  });
});

describe('InstallmentsService.markPaid', () => {
  function buildManager(installment: any, wallet: any) {
    return {
      update: jest.fn(async () => undefined),
      findOne: jest.fn(async (_entity: any, { where: { id } }: any) => {
        if (id === installment.id) return installment;
        if (id === wallet.id) return wallet;
        return null;
      }),
      create: jest.fn((_entity: any, data: any) => ({ ...data })),
      save: jest.fn(async (data: any) => data),
    };
  }

  it('marks the installment paid, clears the block, restores virtualAmount by the PRINCIPAL only, and records a VIRTUAL restore transaction', async () => {
    const { service } = buildService({});
    // principal 280 + fee 50 = amount 330 — only the 280 that was ever
    // drawn from virtualAmount at purchase time should come back; the fee
    // was never part of that draw-down.
    const installment = {
      id: 'installment-1',
      walletId: 'wallet-1',
      amount: '330',
      principalAmount: '280',
    };
    const wallet = { id: 'wallet-1', virtualAmount: '600' };
    const manager = buildManager(installment, wallet);

    await service.markPaid(manager as any, installment.id, 'tx-1');

    expect(manager.update).toHaveBeenCalledWith(expect.anything(), 'wallet-1', {
      blockedAt: null,
    });
    expect(manager.update).toHaveBeenCalledWith(expect.anything(), 'wallet-1', {
      virtualAmount: '880',
    });
    expect(manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'VIRTUAL',
        fromWalletId: null,
        toWalletId: 'wallet-1',
        amount: '280',
        idempotencyKey: 'installment-restore:installment-1',
      }),
    );
  });

  it('restores from a null virtualAmount as if it were zero', async () => {
    const { service } = buildService({});
    const installment = {
      id: 'installment-2',
      walletId: 'wallet-2',
      amount: '250',
      principalAmount: '220',
    };
    const wallet = { id: 'wallet-2', virtualAmount: null };
    const manager = buildManager(installment, wallet);

    await service.markPaid(manager as any, installment.id, 'tx-2');

    expect(manager.update).toHaveBeenCalledWith(expect.anything(), 'wallet-2', {
      virtualAmount: '220',
    });
  });
});

describe('InstallmentsService.getSpendBreakdownsFor', () => {
  it("resolves each draw-down's merchant name from the wallet's storeName, falling back to the owner's identity", async () => {
    const drawDown = {
      id: 'drawdown-1',
      relatedPurchaseId: 'purchase-1',
      amount: '150',
      createdAt: new Date('2026-08-15T00:00:00Z'),
    };
    const { service } = buildService({
      drawDownsByWallet: { 'wallet-1': [drawDown] },
      transactionsById: {
        'purchase-1': { id: 'purchase-1', toWalletId: 'merchant-wallet-1' },
      },
      walletsById: {
        'merchant-wallet-1': {
          id: 'merchant-wallet-1',
          userId: 'merchant-user-1',
          storeName: 'Acme Store',
        },
      },
    });

    const installments = [
      {
        id: 'installment-1',
        walletId: 'wallet-1',
        periodStart: '2026-08-01',
        periodEnd: '2026-09-01',
      },
    ] as any;
    const breakdowns = await service.getSpendBreakdownsFor(installments);

    expect(breakdowns.get('installment-1')).toEqual([
      {
        purchaseId: 'purchase-1',
        merchantName: 'Acme Store',
        amount: '150',
        spentAt: drawDown.createdAt,
      },
    ]);
  });

  it("falls back to the merchant owner's identity when the wallet has no storeName", async () => {
    const drawDown = {
      id: 'drawdown-2',
      relatedPurchaseId: 'purchase-2',
      amount: '75',
      createdAt: new Date('2026-08-16T00:00:00Z'),
    };
    const { service } = buildService({
      drawDownsByWallet: { 'wallet-1': [drawDown] },
      transactionsById: {
        'purchase-2': { id: 'purchase-2', toWalletId: 'merchant-wallet-2' },
      },
      walletsById: {
        'merchant-wallet-2': {
          id: 'merchant-wallet-2',
          userId: 'merchant-user-2',
          storeName: null,
        },
      },
      usersById: {
        'merchant-user-2': {
          email: 'merchant@example.com',
          phoneNumber: null,
        },
      },
    });

    const installments = [
      {
        id: 'installment-1',
        walletId: 'wallet-1',
        periodStart: '2026-08-01',
        periodEnd: '2026-09-01',
      },
    ] as any;
    const breakdowns = await service.getSpendBreakdownsFor(installments);

    expect(breakdowns.get('installment-1')?.[0].merchantName).toBe(
      'merchant@example.com',
    );
  });

  it('computes each unique batch period once and shares it across every installment in that batch', async () => {
    const drawDown = {
      id: 'drawdown-3',
      relatedPurchaseId: 'purchase-3',
      amount: '300',
      createdAt: new Date('2026-08-10T00:00:00Z'),
    };
    const { service, transactionsRepository } = buildService({
      drawDownsByWallet: { 'wallet-1': [drawDown] },
      transactionsById: {
        'purchase-3': { id: 'purchase-3', toWalletId: 'merchant-wallet-1' },
      },
      walletsById: {
        'merchant-wallet-1': {
          id: 'merchant-wallet-1',
          userId: 'merchant-user-1',
          storeName: 'Acme Store',
        },
      },
    });

    const installments = [
      {
        id: 'installment-1',
        walletId: 'wallet-1',
        periodStart: '2026-08-01',
        periodEnd: '2026-09-01',
      },
      {
        id: 'installment-2',
        walletId: 'wallet-1',
        periodStart: '2026-08-01',
        periodEnd: '2026-09-01',
      },
    ] as any;
    const breakdowns = await service.getSpendBreakdownsFor(installments);

    expect(breakdowns.get('installment-1')).toBe(
      breakdowns.get('installment-2'),
    );
    expect(transactionsRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
  });
});
