import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager, In, LessThan, Repository } from 'typeorm';
import { Wallet } from '../wallets/entities/wallet.entity';
import { User } from '../users/entities/user.entity';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from './entities/transaction.entity';
import { WalletsService } from '../wallets/wallets.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { LoggingService } from '../logging/logging.service';
import { serializeWallet } from '../wallets/wallet.serializer';
import { IpgClientService } from '../ipg/ipg-client.service';
import { formatAmount } from '../common/format-amount';

export interface MoneyResult {
  transactionId: string;
  fromWalletId: string | null;
  toWalletId: string | null;
  balance: string;
}

export interface PurchaseInitiateResult {
  transactionId: string;
  redirectUrl: string;
  expiresAt: Date;
}

export interface PurchaseVerifyResult {
  transactionId: string;
  status: TransactionStatus;
  reason?: string;
}

const DEFAULT_PURCHASE_TIMEOUT_SECONDS = 900;

@Injectable()
export class TransactionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly walletsService: WalletsService,
    private readonly idempotencyService: IdempotencyService,
    private readonly loggingService: LoggingService,
    private readonly ipgClientService: IpgClientService,
    private readonly configService: ConfigService,
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

  // Step 1 of the two-phase, IPG-style purchase: creates a PENDING ledger
  // row with no balance change yet, then asks the sandbox IPG for a payment
  // page to redirect the customer to. Money only moves once /verify
  // confirms the gateway authorized it (or the timeout sweep reverses it).
  async initiatePurchase(
    userId: string,
    fromWalletId: string,
    toEmail: string,
    amount: number,
    idempotencyKey: string,
  ): Promise<PurchaseInitiateResult> {
    return this.run(
      'purchase_initiate',
      userId,
      { fromWalletId, toEmail, amount },
      idempotencyKey,
      async (manager) => {
        const fromWalletRef = await this.walletsService.getById(
          userId,
          fromWalletId,
        );
        if (!fromWalletRef.walletType.allowPurchaseOut) {
          throw new ForbiddenException(
            `${fromWalletRef.walletType.name} wallets cannot make purchases`,
          );
        }

        const merchant = await manager.findOne(User, {
          where: { email: toEmail },
        });
        if (!merchant) {
          throw new NotFoundException('Merchant not found');
        }
        if (merchant.id === userId) {
          throw new BadRequestException('Cannot purchase from yourself');
        }

        const toWalletRef =
          await this.walletsService.findEligiblePurchaseInWallet(
            manager,
            merchant.id,
            fromWalletRef.walletType.currencyId,
          );
        if (!toWalletRef) {
          throw new NotFoundException(
            `Merchant has no ${fromWalletRef.walletType.currency.code} wallet eligible to receive purchases`,
          );
        }

        const timeoutSeconds =
          toWalletRef.purchaseTimeoutSeconds ??
          DEFAULT_PURCHASE_TIMEOUT_SECONDS;
        const expiresAt = new Date(Date.now() + timeoutSeconds * 1000);

        const transaction = manager.create(Transaction, {
          type: TransactionType.PURCHASE,
          status: TransactionStatus.PENDING,
          fromWalletId: fromWalletRef.id,
          toWalletId: toWalletRef.id,
          amount: amount.toString(),
          idempotencyKey,
          expiresAt,
        });
        await manager.save(transaction);

        const frontendUrl = this.configService.get<string>('frontendUrl');
        const { authority, paymentUrl } =
          await this.ipgClientService.createPayment({
            merchantName: merchant.email,
            amount: transaction.amount,
            displayAmount: formatAmount(
              amount,
              fromWalletRef.walletType.currency,
            ),
            callbackUrl: `${frontendUrl}/purchase/${transaction.id}/callback`,
            timeoutSeconds,
          });

        transaction.ipgAuthority = authority;
        transaction.ipgPaymentUrl = paymentUrl;
        await manager.save(transaction);

        return {
          transactionId: transaction.id,
          redirectUrl: paymentUrl,
          expiresAt,
        };
      },
    );
  }

  // Step 2: called once the customer's browser lands back on the callback
  // URL with a successful IPG confirmation. Server-to-server verifies with
  // the IPG (one-time, so a duplicate call is harmless) and only then moves
  // real money — debiting the customer and crediting the merchant.
  async verifyPurchase(
    userId: string,
    transactionId: string,
  ): Promise<PurchaseVerifyResult> {
    return this.dataSource.transaction(async (manager) => {
      const transaction = await manager
        .createQueryBuilder(Transaction, 't')
        .setLock('pessimistic_write')
        .where('t.id = :transactionId', { transactionId })
        .andWhere('t.type = :type', { type: TransactionType.PURCHASE })
        .getOne();
      if (!transaction) {
        throw new NotFoundException('Purchase not found');
      }

      await this.assertOwnsEitherSide(userId, transaction);

      if (transaction.status === TransactionStatus.COMPLETED) {
        return { transactionId: transaction.id, status: transaction.status };
      }
      if (transaction.status === TransactionStatus.REVERSED) {
        throw new UnprocessableEntityException(
          'This purchase was reversed and can no longer be verified',
        );
      }

      if (
        transaction.expiresAt &&
        transaction.expiresAt.getTime() < Date.now()
      ) {
        transaction.status = TransactionStatus.REVERSED;
        await manager.save(transaction);
        throw new GoneException(
          'The verification window for this purchase has expired',
        );
      }

      const verifyResult = await this.ipgClientService.verifyPayment(
        transaction.ipgAuthority!,
        transaction.amount,
      );
      if (!verifyResult.success) {
        return {
          transactionId: transaction.id,
          status: transaction.status,
          reason: verifyResult.reason,
        };
      }

      const fromWalletRef = await this.walletsService.getByIdUnscoped(
        transaction.fromWalletId!,
      );
      const orderedIds = [
        transaction.fromWalletId!,
        transaction.toWalletId!,
      ].sort();
      const locked = new Map<string, Wallet>();
      for (const id of orderedIds) {
        locked.set(id, await this.walletsService.lockById(manager, id));
      }
      const fromWallet = locked.get(transaction.fromWalletId!)!;
      const toWallet = locked.get(transaction.toWalletId!)!;

      const floor = fromWalletRef.walletType.allowNegativeBalance
        ? -BigInt(fromWalletRef.walletType.creditLimit ?? '0')
        : 0n;
      const newFromBalance =
        BigInt(fromWallet.balance) - BigInt(transaction.amount);
      if (newFromBalance < floor) {
        transaction.status = TransactionStatus.REVERSED;
        await manager.save(transaction);
        throw new UnprocessableEntityException(
          'Insufficient balance to complete this purchase',
        );
      }
      const newToBalance =
        BigInt(toWallet.balance) + BigInt(transaction.amount);

      await manager.update(Wallet, fromWallet.id, {
        balance: newFromBalance.toString(),
      });
      await manager.update(Wallet, toWallet.id, {
        balance: newToBalance.toString(),
      });

      transaction.status = TransactionStatus.COMPLETED;
      await manager.save(transaction);

      await this.loggingService.log({
        category: 'TRANSACTION',
        action: 'PURCHASE_VERIFY',
        success: true,
        userId,
        metadata: { transactionId: transaction.id },
      });

      return { transactionId: transaction.id, status: transaction.status };
    });
  }

  // Cancels a still-PENDING purchase (customer backed out on the IPG page,
  // or the merchant/admin issues a refund after COMPLETED). PENDING has no
  // balance to unwind — nothing ever moved. COMPLETED does: credit the
  // customer back, debit the merchant, and record the reversal as its own
  // linked ledger row rather than rewriting the original.
  async reverseTransaction(
    userId: string,
    transactionId: string,
    reason: string | undefined,
    idempotencyKey: string,
  ): Promise<MoneyResult> {
    return this.run(
      'purchase_reverse',
      userId,
      { transactionId, reason },
      idempotencyKey,
      async (manager) => {
        const original = await manager
          .createQueryBuilder(Transaction, 't')
          .setLock('pessimistic_write')
          .where('t.id = :transactionId', { transactionId })
          .andWhere('t.type = :type', { type: TransactionType.PURCHASE })
          .getOne();
        if (!original) {
          throw new NotFoundException('Purchase not found');
        }
        await this.assertOwnsEitherSide(userId, original);

        if (original.status === TransactionStatus.REVERSED) {
          throw new ConflictException('This purchase was already reversed');
        }

        if (original.status === TransactionStatus.PENDING) {
          original.status = TransactionStatus.REVERSED;
          await manager.save(original);
          return {
            transactionId: original.id,
            fromWalletId: original.fromWalletId,
            toWalletId: original.toWalletId,
            balance: '0',
          };
        }

        // COMPLETED: money already moved at verify time, so refund it —
        // credit the customer (original fromWallet), debit the merchant
        // (original toWallet).
        const merchantWalletRef = await this.walletsService.getByIdUnscoped(
          original.toWalletId!,
        );
        const orderedIds = [
          original.fromWalletId!,
          original.toWalletId!,
        ].sort();
        const locked = new Map<string, Wallet>();
        for (const id of orderedIds) {
          locked.set(id, await this.walletsService.lockById(manager, id));
        }
        const customerWallet = locked.get(original.fromWalletId!)!;
        const merchantWallet = locked.get(original.toWalletId!)!;

        const merchantFloor = merchantWalletRef.walletType.allowNegativeBalance
          ? -BigInt(merchantWalletRef.walletType.creditLimit ?? '0')
          : 0n;
        const newMerchantBalance =
          BigInt(merchantWallet.balance) - BigInt(original.amount);
        if (newMerchantBalance < merchantFloor) {
          throw new UnprocessableEntityException(
            "Merchant's balance is too low to refund this purchase",
          );
        }
        const newCustomerBalance =
          BigInt(customerWallet.balance) + BigInt(original.amount);

        await manager.update(Wallet, merchantWallet.id, {
          balance: newMerchantBalance.toString(),
        });
        await manager.update(Wallet, customerWallet.id, {
          balance: newCustomerBalance.toString(),
        });

        original.status = TransactionStatus.REVERSED;
        await manager.save(original);

        const reversal = manager.create(Transaction, {
          type: TransactionType.PURCHASE,
          status: TransactionStatus.REVERSED,
          fromWalletId: merchantWallet.id,
          toWalletId: customerWallet.id,
          amount: original.amount,
          idempotencyKey: `${idempotencyKey}:reversal`,
          note: reason ?? 'Refund',
          performedByUserId: userId,
          relatedTransactionId: original.id,
        });
        await manager.save(reversal);

        return {
          transactionId: reversal.id,
          fromWalletId: reversal.fromWalletId,
          toWalletId: reversal.toWalletId,
          balance: newCustomerBalance.toString(),
        };
      },
    );
  }

  // Used by the timeout sweep: every PENDING purchase past its expiresAt,
  // never verified in time.
  async findExpiredPendingPurchases(): Promise<Transaction[]> {
    return this.transactionsRepository.find({
      where: {
        type: TransactionType.PURCHASE,
        status: TransactionStatus.PENDING,
        expiresAt: LessThan(new Date()),
      },
    });
  }

  // Marks a single PENDING purchase REVERSED because the merchant never
  // verified it before the timeout — no balance to unwind, since nothing
  // moves until /verify succeeds.
  async expirePendingPurchase(transactionId: string): Promise<void> {
    await this.transactionsRepository
      .createQueryBuilder()
      .update(Transaction)
      .set({ status: TransactionStatus.REVERSED })
      .where('id = :transactionId', { transactionId })
      .andWhere('status = :pending', { pending: TransactionStatus.PENDING })
      .execute();
  }

  // Merchant wallet auto-withdraw sweep: takes the full positive balance out
  // as a plain WITHDRAW ledger row. System-triggered (the scheduler), so
  // there's no caller to check ownership against and no Idempotency-Key
  // header — the key is derived from the wallet + minute so a scheduler
  // that somehow fires twice in the same minute doesn't double-withdraw.
  async sweepAutoWithdraw(walletId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const wallet = await this.walletsService.lockById(manager, walletId);
      if (BigInt(wallet.balance) <= 0n) {
        return;
      }

      await manager.update(Wallet, wallet.id, { balance: '0' });
      const transaction = manager.create(Transaction, {
        type: TransactionType.WITHDRAW,
        fromWalletId: wallet.id,
        toWalletId: null,
        amount: wallet.balance,
        idempotencyKey: `auto-withdraw:${wallet.id}:${new Date().toISOString().slice(0, 16)}`,
      });
      await manager.save(transaction);
    });
  }

  private async assertOwnsEitherSide(
    userId: string,
    transaction: Transaction,
  ): Promise<void> {
    const [fromWallet, toWallet] = await Promise.all([
      transaction.fromWalletId
        ? this.walletsService.getByIdUnscoped(transaction.fromWalletId)
        : null,
      transaction.toWalletId
        ? this.walletsService.getByIdUnscoped(transaction.toWalletId)
        : null,
    ]);
    const owns = fromWallet?.userId === userId || toWallet?.userId === userId;
    if (!owns) {
      throw new ForbiddenException('This transaction does not belong to you');
    }
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

  // Admin use only: every transaction in the system, most recent first.
  async listAll(limit = 200): Promise<Transaction[]> {
    return this.transactionsRepository.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  // Full detail for a single transaction, including the type/currency of
  // whichever wallet(s) it touched — enough for a standalone detail view
  // without extra round trips. Scoped to transactions that touch at least
  // one of the caller's own wallets.
  async getById(userId: string, transactionId: string) {
    const transaction = await this.transactionsRepository.findOne({
      where: { id: transactionId },
    });
    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    const [fromWallet, toWallet] = await Promise.all([
      transaction.fromWalletId
        ? this.walletsService.getByIdUnscoped(transaction.fromWalletId)
        : null,
      transaction.toWalletId
        ? this.walletsService.getByIdUnscoped(transaction.toWalletId)
        : null,
    ]);

    const ownsFrom = fromWallet?.userId === userId;
    const ownsTo = toWallet?.userId === userId;
    if (!ownsFrom && !ownsTo) {
      throw new ForbiddenException('This transaction does not belong to you');
    }

    return {
      id: transaction.id,
      type: transaction.type,
      amount: transaction.amount,
      note: transaction.note,
      idempotencyKey: transaction.idempotencyKey,
      createdAt: transaction.createdAt,
      fromWallet: fromWallet ? serializeWallet(fromWallet) : null,
      toWallet: toWallet ? serializeWallet(toWallet) : null,
      direction: ownsFrom && ownsTo ? 'BOTH' : ownsFrom ? 'OUT' : 'IN',
      status: transaction.status,
      expiresAt: transaction.expiresAt,
      relatedTransactionId: transaction.relatedTransactionId,
    };
  }

  private async run<T>(
    action:
      | 'deposit'
      | 'withdraw'
      | 'transfer'
      | 'adjustment'
      | 'purchase_initiate'
      | 'purchase_reverse',
    userId: string,
    payload: Record<string, unknown>,
    idempotencyKey: string,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
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
          return claim.responseBody as unknown as T;
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
