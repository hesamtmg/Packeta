import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
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
    amount: number,
    idempotencyKey: string,
  ): Promise<MoneyResult> {
    return this.run(
      'deposit',
      userId,
      { amount },
      idempotencyKey,
      async (manager) => {
        const wallet = await this.walletsService.lockByUserId(manager, userId);
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
    amount: number,
    idempotencyKey: string,
  ): Promise<MoneyResult> {
    return this.run(
      'withdraw',
      userId,
      { amount },
      idempotencyKey,
      async (manager) => {
        const wallet = await this.walletsService.lockByUserId(manager, userId);
        if (BigInt(wallet.balance) < BigInt(amount)) {
          throw new UnprocessableEntityException('Insufficient balance');
        }
        const newBalance = (BigInt(wallet.balance) - BigInt(amount)).toString();
        await manager.update(Wallet, wallet.id, { balance: newBalance });

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
          balance: newBalance,
        };
      },
    );
  }

  async transfer(
    userId: string,
    toEmail: string,
    amount: number,
    idempotencyKey: string,
  ): Promise<MoneyResult> {
    return this.run(
      'transfer',
      userId,
      { toEmail, amount },
      idempotencyKey,
      async (manager) => {
        const recipient = await manager.findOne(User, {
          where: { email: toEmail },
        });
        if (!recipient) {
          throw new NotFoundException('Recipient not found');
        }
        if (recipient.id === userId) {
          throw new BadRequestException('Cannot transfer to your own wallet');
        }

        const [senderWalletRef, recipientWalletRef] = await Promise.all([
          this.walletsService.getByUserId(userId),
          this.walletsService.getByUserId(recipient.id),
        ]);

        // Lock both wallet rows in a fixed order (ascending wallet id)
        // regardless of transfer direction, so two concurrent transfers
        // between the same pair of wallets can never deadlock.
        const orderedIds = [senderWalletRef.id, recipientWalletRef.id].sort();
        const locked = new Map<string, Wallet>();
        for (const id of orderedIds) {
          locked.set(id, await this.walletsService.lockById(manager, id));
        }
        const senderWallet = locked.get(senderWalletRef.id)!;
        const recipientWallet = locked.get(recipientWalletRef.id)!;

        if (BigInt(senderWallet.balance) < BigInt(amount)) {
          throw new UnprocessableEntityException('Insufficient balance');
        }

        const newSenderBalance = (
          BigInt(senderWallet.balance) - BigInt(amount)
        ).toString();
        const newRecipientBalance = (
          BigInt(recipientWallet.balance) + BigInt(amount)
        ).toString();

        await manager.update(Wallet, senderWallet.id, {
          balance: newSenderBalance,
        });
        await manager.update(Wallet, recipientWallet.id, {
          balance: newRecipientBalance,
        });

        const transaction = manager.create(Transaction, {
          type: TransactionType.TRANSFER,
          fromWalletId: senderWallet.id,
          toWalletId: recipientWallet.id,
          amount: amount.toString(),
          idempotencyKey,
        });
        await manager.save(transaction);

        return {
          transactionId: transaction.id,
          fromWalletId: senderWallet.id,
          toWalletId: recipientWallet.id,
          balance: newSenderBalance,
        };
      },
    );
  }

  async getHistory(userId: string): Promise<Transaction[]> {
    const wallet = await this.walletsService.getByUserId(userId);
    return this.transactionsRepository.find({
      where: [{ fromWalletId: wallet.id }, { toWalletId: wallet.id }],
      order: { createdAt: 'DESC' },
    });
  }

  private async run(
    action: 'deposit' | 'withdraw' | 'transfer',
    userId: string,
    payload: Record<string, unknown>,
    idempotencyKey: string,
    work: (manager: import('typeorm').EntityManager) => Promise<MoneyResult>,
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
