import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Wallet } from '../wallets/entities/wallet.entity';
import { User } from '../users/entities/user.entity';
import { Transaction, TransactionType } from './entities/transaction.entity';
import { WalletsService } from '../wallets/wallets.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { LoggingService } from '../logging/logging.service';

export interface MoneyResult {
  transactionId: string;
  fromWalletId: string | null;
  toWalletId: string | null;
  balance: string;
}

@Injectable()
export class TransactionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly walletsService: WalletsService,
    private readonly idempotencyService: IdempotencyService,
    private readonly loggingService: LoggingService,
    @InjectRepository(Transaction)
    private readonly transactionsRepository: Repository<Transaction>,
  ) {}

  async deposit(
    userId: string,
    walletId: string,
    amount: number,
    idempotencyKey: string,
  ): Promise<MoneyResult> {
    return this.run(
      'deposit',
      userId,
      { walletId, amount },
      idempotencyKey,
      async (manager) => {
        // Ownership check; deposits are allowed on every wallet type.
        await this.walletsService.getById(userId, walletId);

        const wallet = await this.walletsService.lockById(manager, walletId);
        const newBalance = (BigInt(wallet.balance) + BigInt(amount)).toString();
        await manager.update(Wallet, wallet.id, { balance: newBalance });

        const transaction = manager.create(Transaction, {
          type: TransactionType.DEPOSIT,
          fromWalletId: null,
          toWalletId: wallet.id,
          amount: amount.toString(),
          idempotencyKey,
        });
        await manager.save(transaction);

        return {
          transactionId: transaction.id,
          fromWalletId: null,
          toWalletId: wallet.id,
          balance: newBalance,
        };
      },
    );
  }

  async withdraw(
    userId: string,
    walletId: string,
    amount: number,
    idempotencyKey: string,
  ): Promise<MoneyResult> {
    return this.run(
      'withdraw',
      userId,
      { walletId, amount },
      idempotencyKey,
      async (manager) => {
        const walletRef = await this.walletsService.getById(userId, walletId);
        if (!walletRef.walletType.allowWithdraw) {
          throw new ForbiddenException(
            `${walletRef.walletType.name} wallets do not support withdrawals`,
          );
        }

        const wallet = await this.walletsService.lockById(manager, walletId);
        const floor = walletRef.walletType.allowNegativeBalance
          ? -BigInt(walletRef.walletType.creditLimit ?? '0')
          : 0n;
        const newBalance = BigInt(wallet.balance) - BigInt(amount);
        if (newBalance < floor) {
          throw new UnprocessableEntityException('Insufficient balance');
        }
        await manager.update(Wallet, wallet.id, {
          balance: newBalance.toString(),
        });

        const transaction = manager.create(Transaction, {
          type: TransactionType.WITHDRAW,
          fromWalletId: wallet.id,
          toWalletId: null,
          amount: amount.toString(),
          idempotencyKey,
        });
        await manager.save(transaction);

        return {
          transactionId: transaction.id,
          fromWalletId: wallet.id,
          toWalletId: null,
          balance: newBalance.toString(),
        };
      },
    );
  }

  async transfer(
    userId: string,
    fromWalletId: string,
    toEmail: string,
    amount: number,
    idempotencyKey: string,
  ): Promise<MoneyResult> {
    return this.run(
      'transfer',
      userId,
      { fromWalletId, toEmail, amount },
      idempotencyKey,
      async (manager) => {
        const fromWalletRef = await this.walletsService.getById(
          userId,
          fromWalletId,
        );
        if (!fromWalletRef.walletType.allowP2pOut) {
          throw new ForbiddenException(
            `${fromWalletRef.walletType.name} wallets cannot send transfers`,
          );
        }

        const recipient = await manager.findOne(User, {
          where: { email: toEmail },
        });
        if (!recipient) {
          throw new NotFoundException('Recipient not found');
        }
        if (recipient.id === userId) {
          throw new BadRequestException('Cannot transfer to your own wallet');
        }

        const toWalletRef = await this.walletsService.findEligibleP2pInWallet(
          manager,
          recipient.id,
          fromWalletRef.walletType.currencyId,
        );
        if (!toWalletRef) {
          throw new NotFoundException(
            `Recipient has no ${fromWalletRef.walletType.currency.code} wallet eligible to receive this transfer`,
          );
        }

        // Lock both wallet rows in a fixed order (ascending wallet id)
        // regardless of transfer direction, so two concurrent transfers
        // between the same pair of wallets can never deadlock.
        const orderedIds = [fromWalletRef.id, toWalletRef.id].sort();
        const locked = new Map<string, Wallet>();
        for (const id of orderedIds) {
          locked.set(id, await this.walletsService.lockById(manager, id));
        }
        const fromWallet = locked.get(fromWalletRef.id)!;
        const toWallet = locked.get(toWalletRef.id)!;

        const floor = fromWalletRef.walletType.allowNegativeBalance
          ? -BigInt(fromWalletRef.walletType.creditLimit ?? '0')
          : 0n;
        const newFromBalance = BigInt(fromWallet.balance) - BigInt(amount);
        if (newFromBalance < floor) {
          throw new UnprocessableEntityException('Insufficient balance');
        }
        const newToBalance = (
          BigInt(toWallet.balance) + BigInt(amount)
        ).toString();

        await manager.update(Wallet, fromWallet.id, {
          balance: newFromBalance.toString(),
        });
        await manager.update(Wallet, toWallet.id, { balance: newToBalance });

        const transaction = manager.create(Transaction, {
          type: TransactionType.TRANSFER,
          fromWalletId: fromWallet.id,
          toWalletId: toWallet.id,
          amount: amount.toString(),
          idempotencyKey,
        });
        await manager.save(transaction);

        return {
          transactionId: transaction.id,
          fromWalletId: fromWallet.id,
          toWalletId: toWallet.id,
          balance: newFromBalance.toString(),
        };
      },
    );
  }

  // Admin-only manual correction. amount is signed (positive credits,
  // negative debits) and still bounded by the wallet's own floor (0, or
  // -creditLimit) — admins can correct balances, not bypass the wallet
  // type's fundamental rules.
  async adjust(
    adminUserId: string,
    walletId: string,
    amount: number,
    reason: string,
    idempotencyKey: string,
  ): Promise<MoneyResult> {
    if (amount === 0) {
      throw new BadRequestException('amount must not be zero');
    }

    return this.run(
      'adjustment',
      adminUserId,
      { walletId, amount, reason },
      idempotencyKey,
      async (manager) => {
        const walletRef = await this.walletsService.getByIdUnscoped(walletId);
        const floor = walletRef.walletType.allowNegativeBalance
          ? -BigInt(walletRef.walletType.creditLimit ?? '0')
          : 0n;

        const wallet = await this.walletsService.lockById(manager, walletId);
        const newBalance = BigInt(wallet.balance) + BigInt(amount);
        if (newBalance < floor) {
          throw new UnprocessableEntityException(
            "Adjustment would take the wallet below its type's allowed balance floor",
          );
        }
        await manager.update(Wallet, wallet.id, {
          balance: newBalance.toString(),
        });

        const absAmount = BigInt(Math.abs(amount));
        const transaction = manager.create(Transaction, {
          type: TransactionType.ADJUSTMENT,
          fromWalletId: amount < 0 ? wallet.id : null,
          toWalletId: amount >= 0 ? wallet.id : null,
          amount: absAmount.toString(),
          idempotencyKey,
          note: reason,
          performedByUserId: adminUserId,
        });
        await manager.save(transaction);

        return {
          transactionId: transaction.id,
          fromWalletId: transaction.fromWalletId,
          toWalletId: transaction.toWalletId,
          balance: newBalance.toString(),
        };
      },
    );
  }

  async getHistory(userId: string, walletId?: string): Promise<Transaction[]> {
    const wallets = walletId
      ? [await this.walletsService.getById(userId, walletId)]
      : await this.walletsService.listForUser(userId);
    const walletIds = wallets.map((wallet) => wallet.id);
    if (walletIds.length === 0) {
      return [];
    }
    return this.transactionsRepository.find({
      where: [{ fromWalletId: In(walletIds) }, { toWalletId: In(walletIds) }],
      order: { createdAt: 'DESC' },
    });
  }

  private async run(
    action: 'deposit' | 'withdraw' | 'transfer' | 'adjustment',
    userId: string,
    payload: Record<string, unknown>,
    idempotencyKey: string,
    work: (manager: EntityManager) => Promise<MoneyResult>,
  ): Promise<MoneyResult> {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const claim = await this.idempotencyService.claim(manager, {
          key: idempotencyKey,
          userId,
          endpoint: action,
          payload,
        });
        if (claim.replay) {
          return claim.responseBody as unknown as MoneyResult;
        }

        const responseBody = await work(manager);
        await this.idempotencyService.complete(
          manager,
          idempotencyKey,
          responseBody as unknown as Record<string, any>,
        );
        return responseBody;
      });

      await this.loggingService.log({
        category: 'TRANSACTION',
        action: action.toUpperCase(),
        success: true,
        userId,
        metadata: { ...payload },
      });

      return result;
    } catch (error) {
      await this.loggingService.log({
        category: 'TRANSACTION',
        action: action.toUpperCase(),
        success: false,
        userId,
        metadata: { ...payload, error: (error as Error).message },
      });
      throw error;
    }
  }
}
