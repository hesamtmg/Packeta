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
import {
  WalletType,
  WalletTypeCode,
} from '../wallet-types/entities/wallet-type.entity';
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
import { ZarinpalClientService } from '../ipg/zarinpal-client.service';
import { CurrenciesService } from '../currencies/currencies.service';
import { formatAmount } from '../common/format-amount';
import { displayIdentity } from '../common/synthetic-email';
import { SettlementService } from '../settlement/settlement.service';
import { SettlementSplitDto } from '../settlement/dto/settlement-split.dto';
import { InstallmentsService } from '../installments/installments.service';
import {
  Installment,
  InstallmentStatus,
} from '../installments/entities/installment.entity';
import { RailSettlementsService } from '../rail-settlements/rail-settlements.service';
import { SettlementRailType } from '../rail-settlements/entities/rail-settlement.entity';

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
  // Only set when this verify call resolves a credit-shortfall top-up (see
  // completeSupportTopUp): the merchant's own callbackUrl to send the
  // customer's browser back to now that the purchase is settled, one way
  // or the other — not the server-to-server webhook notifyMerchantCallback
  // already fired, but the customer-facing return trip.
  redirectUrl?: string;
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
    private readonly zarinpalClientService: ZarinpalClientService,
    private readonly configService: ConfigService,
    private readonly currenciesService: CurrenciesService,
    private readonly settlementService: SettlementService,
    private readonly installmentsService: InstallmentsService,
    private readonly railSettlementsService: RailSettlementsService,
    @InjectRepository(Transaction)
    private readonly transactionsRepository: Repository<Transaction>,
  ) {}

  // Step 1 of the two-phase, IPG-style deposit: creates a PENDING ledger row
  // with no balance change yet, then asks ZarinPal — a real payment gateway,
  // not the in-house sandbox IPG used by purchase/installment flows — for a
  // payment page to redirect the depositor to. Real money only lands in the
  // wallet once /verify confirms ZarinPal actually authorized it — see
  // verifyPurchase, which credits fromWalletId-less rows like this one
  // straight to toWallet.
  async deposit(
    userId: string,
    walletId: string,
    amount: number,
    idempotencyKey: string,
  ): Promise<PurchaseInitiateResult> {
    return this.run(
      'deposit',
      userId,
      { walletId, amount },
      idempotencyKey,
      async (manager) => {
        const walletRef = await this.walletsService.getById(userId, walletId);
        if (walletRef.closedAt) {
          throw new BadRequestException('This wallet is closed');
        }
        if (!walletRef.walletType.depositable) {
          throw new ForbiddenException(
            `${walletRef.walletType.name} wallets do not accept deposits`,
          );
        }
        this.walletsService.assertWithinTransactionLimits(walletRef, amount);

        const timeoutSeconds = DEFAULT_PURCHASE_TIMEOUT_SECONDS;
        const expiresAt = new Date(Date.now() + timeoutSeconds * 1000);

        const transaction = manager.create(Transaction, {
          type: TransactionType.DEPOSIT,
          status: TransactionStatus.PENDING,
          fromWalletId: null,
          toWalletId: walletRef.id,
          amount: amount.toString(),
          idempotencyKey,
          expiresAt,
        });
        await manager.save(transaction);

        const frontendUrl = this.configService.get<string>('frontendUrl');
        const { authority, paymentUrl } =
          await this.zarinpalClientService.createPayment({
            merchantName: 'Deposit',
            amount: transaction.amount,
            displayAmount: formatAmount(amount, walletRef.walletType.currency),
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

  // Merchant-style wallet types (walletType.supportsAutoWithdraw) never
  // withdraw manually — their balance only leaves on the auto-withdraw sweep
  // schedule (see AutoWithdrawSweepService/SettlementRailSweepService), so
  // this rejects the request outright rather than performing it. Every
  // other wallet's manual withdrawal must say which interbank rail (Pol Pay
  // / Paya / Satna / bank transfer) it goes out over — recorded as a
  // RailSettlement audit row alongside the WITHDRAW, the same way an
  // auto-swept payout is (see sweepAutoWithdraw's recordRailSettlement).
  async withdraw(
    userId: string,
    walletId: string,
    amount: number,
    railType: SettlementRailType,
    idempotencyKey: string,
  ): Promise<MoneyResult> {
    return this.run(
      'withdraw',
      userId,
      { walletId, amount, railType },
      idempotencyKey,
      async (manager) => {
        const walletRef = await this.walletsService.getById(userId, walletId);
        if (walletRef.closedAt) {
          throw new BadRequestException('This wallet is closed');
        }
        this.assertNotBlocked(walletRef);
        if (walletRef.walletType.supportsAutoWithdraw) {
          throw new ForbiddenException(
            `${walletRef.walletType.name} wallets withdraw automatically on schedule — manual withdrawal is not available`,
          );
        }
        if (!walletRef.walletType.allowWithdraw) {
          throw new ForbiddenException(
            `${walletRef.walletType.name} wallets do not support withdrawals`,
          );
        }
        this.walletsService.assertWithinTransactionLimits(walletRef, amount);

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
        await this.debitLinkedRepository(manager, walletRef, BigInt(amount));

        const transaction = manager.create(Transaction, {
          type: TransactionType.WITHDRAW,
          fromWalletId: wallet.id,
          toWalletId: null,
          amount: amount.toString(),
          idempotencyKey,
        });
        await manager.save(transaction);

        const settlement = await this.railSettlementsService.createForSweep(
          manager,
          {
            walletId: wallet.id,
            railType,
            amount: amount.toString(),
            destinationIban: null,
            label: null,
            transactionId: transaction.id,
            scheduledFor: new Date(),
          },
        );
        await manager.update(Transaction, transaction.id, {
          railSettlementId: settlement.id,
        });

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
        if (fromWalletRef.closedAt) {
          throw new BadRequestException('This wallet is closed');
        }
        this.assertNotBlocked(fromWalletRef);
        if (!fromWalletRef.walletType.allowP2pOut) {
          throw new ForbiddenException(
            `${fromWalletRef.walletType.name} wallets cannot send transfers`,
          );
        }

        const sender = await manager.findOne(User, { where: { id: userId } });
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
        if (
          !this.walletsService.isCounterpartyAllowed(
            fromWalletRef.restrictedCounterparties,
            toEmail,
            toWalletRef.restrictedCounterparties,
            sender!.email,
          )
        ) {
          throw new ForbiddenException(
            'This transfer is not allowed between these two wallets',
          );
        }
        this.walletsService.assertWithinTransactionLimits(
          fromWalletRef,
          amount,
        );
        this.walletsService.assertWithinTransactionLimits(toWalletRef, amount);

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
        await this.debitLinkedRepository(
          manager,
          fromWalletRef,
          BigInt(amount),
        );

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
        if (walletRef.closedAt) {
          throw new BadRequestException('This wallet is closed');
        }
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
        if (fromWalletRef.closedAt) {
          throw new BadRequestException('This wallet is closed');
        }
        this.assertNotBlocked(fromWalletRef);
        if (!fromWalletRef.walletType.allowPurchaseOut) {
          throw new ForbiddenException(
            `${fromWalletRef.walletType.name} wallets cannot make purchases`,
          );
        }

        const customer = await manager.findOne(User, {
          where: { id: userId },
        });
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
        if (
          !this.walletsService.isCounterpartyAllowed(
            fromWalletRef.restrictedCounterparties,
            toEmail,
            toWalletRef.restrictedCounterparties,
            customer!.email,
          )
        ) {
          throw new ForbiddenException(
            'This purchase is not allowed between these two wallets',
          );
        }
        this.walletsService.assertWithinTransactionLimits(
          fromWalletRef,
          amount,
        );
        this.walletsService.assertWithinTransactionLimits(toWalletRef, amount);

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

  // Repays one of a credit wallet's scheduled installments (see
  // InstallmentsService). Unlike a regular purchase, this is always real
  // money paid directly through ZarinPal (same gateway as deposit()) —
  // there is no "pay from another wallet" option — so the resulting row has
  // no fromWalletId at all (see the walletless branch at the top of
  // verifyPurchase, which credits straight to toWallet). Once verified, the
  // amount lands in the repository's real balance, the installment is
  // marked PAID, and the credit wallet's virtualAmount is restored by the
  // installment's amount (see InstallmentsService.markPaid, called from the
  // installmentId branch at the end of verifyPurchase). If the credit
  // wallet is currently blocked (a previous installment went OVERDUE), the
  // type's unblockFee is folded into this charge and the block is lifted on
  // success.
  async payInstallment(
    userId: string,
    installmentId: string,
    idempotencyKey: string,
  ): Promise<PurchaseInitiateResult> {
    return this.run(
      'installment_pay',
      userId,
      { installmentId },
      idempotencyKey,
      async (manager) => {
        const installment = await this.installmentsService.getByIdForUser(
          userId,
          installmentId,
        );
        if (installment.status === InstallmentStatus.PAID) {
          throw new ConflictException('This installment has already been paid');
        }
        const creditWallet = installment.wallet;
        if (!creditWallet.repositoryWalletId) {
          throw new BadRequestException(
            'This wallet has no linked repository to repay',
          );
        }

        const repository = await this.walletsService.getByIdUnscoped(
          creditWallet.repositoryWalletId,
        );
        if (repository.closedAt) {
          throw new BadRequestException('This repository wallet is closed');
        }
        if (!repository.walletType.allowPurchaseIn) {
          throw new BadRequestException(
            'This repository does not accept installment repayments',
          );
        }

        const unblockFee = creditWallet.blockedAt
          ? BigInt(creditWallet.walletType.unblockFee ?? '0')
          : 0n;
        const chargeAmount = BigInt(installment.amount) + unblockFee;

        const timeoutSeconds = DEFAULT_PURCHASE_TIMEOUT_SECONDS;
        const expiresAt = new Date(Date.now() + timeoutSeconds * 1000);

        const transaction = manager.create(Transaction, {
          type: TransactionType.DEPOSIT,
          status: TransactionStatus.PENDING,
          fromWalletId: null,
          toWalletId: repository.id,
          amount: chargeAmount.toString(),
          idempotencyKey,
          expiresAt,
          installmentId: installment.id,
        });
        await manager.save(transaction);

        const frontendUrl = this.configService.get<string>('frontendUrl');
        const { authority, paymentUrl } =
          await this.zarinpalClientService.createPayment({
            merchantName: 'Installment repayment',
            amount: transaction.amount,
            displayAmount: formatAmount(
              chargeAmount.toString(),
              repository.walletType.currency,
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

  // Loads the wallet + repository + outstanding-balance total shared by all
  // three overdue-collection methods below, and rejects anything that isn't
  // actually a blocked, repository-backed credit wallet with money owed.
  private async loadOverdueCollectionContext(walletId: string): Promise<{
    creditWallet: Wallet;
    repository: Wallet;
    outstanding: Installment[];
    totalOwed: bigint;
  }> {
    const creditWallet = await this.walletsService.getByIdUnscoped(walletId);
    if (!creditWallet.blockedAt) {
      throw new BadRequestException(
        'This wallet is not currently blocked for overdue installments',
      );
    }
    if (!creditWallet.repositoryWalletId) {
      throw new BadRequestException(
        'This wallet has no linked repository to repay',
      );
    }
    const repository = await this.walletsService.getByIdUnscoped(
      creditWallet.repositoryWalletId,
    );
    const outstanding =
      await this.installmentsService.getOutstandingForWallet(walletId);
    if (!outstanding.length) {
      throw new BadRequestException(
        'This wallet has no outstanding installments to collect',
      );
    }
    const totalOwed =
      outstanding.reduce((sum, i) => sum + BigInt(i.amount), 0n) +
      BigInt(creditWallet.walletType.unblockFee ?? '0');
    return { creditWallet, repository, outstanding, totalOwed };
  }

  // Routes an installment repayment's fee/penalty/unblock-fee slices to
  // their own dedicated repositories (see WalletType.feeRepositoryWalletId/
  // penaltyRepositoryWalletId/unblockFeeRepositoryWalletId) instead of the
  // credit wallet's main backing repository — falling back to leaving a
  // slice on the main repository for any component whose sub-repository
  // isn't configured (or has since been closed), so this is a no-op split
  // on a CREDIT type that hasn't set any of the three up. Returns the sum of
  // whatever couldn't be routed, for the caller to fold back into the main
  // repository's own credit/debit.
  //
  // Used two ways: `legType: DEPOSIT` for verifyPurchase's real-money-in
  // branch, where the slice is new money in from ZarinPal landing directly
  // on a sub-repository (fromWalletId null, same as the parent DEPOSIT);
  // `legType: TRANSFER` for collectOverdueFromRepository, where the slice
  // instead comes out of the main repository's own already-debited balance
  // (fromWalletId set to it).
  private async creditFeeSplitLegs(
    manager: EntityManager,
    mainRepository: Wallet,
    walletType: WalletType,
    parts: { fee: bigint; penalty: bigint; unblockFee: bigint },
    legType: TransactionType.DEPOSIT | TransactionType.TRANSFER,
    keyPrefix: string,
  ): Promise<bigint> {
    const legs: [bigint, string | null, string][] = [
      [parts.fee, walletType.feeRepositoryWalletId, 'fee'],
      [parts.penalty, walletType.penaltyRepositoryWalletId, 'penalty'],
      [
        parts.unblockFee,
        walletType.unblockFeeRepositoryWalletId,
        'unblock fee',
      ],
    ];
    let unrouted = 0n;
    for (const [amount, subRepositoryId, label] of legs) {
      if (amount <= 0n) continue;
      if (!subRepositoryId) {
        unrouted += amount;
        continue;
      }
      const subRepository = await this.walletsService.lockById(
        manager,
        subRepositoryId,
      );
      if (subRepository.closedAt) {
        unrouted += amount;
        continue;
      }
      await manager.update(Wallet, subRepository.id, {
        balance: (BigInt(subRepository.balance) + amount).toString(),
      });
      const leg = manager.create(Transaction, {
        type: legType,
        fromWalletId:
          legType === TransactionType.TRANSFER ? mainRepository.id : null,
        toWalletId: subRepository.id,
        amount: amount.toString(),
        idempotencyKey: `${keyPrefix}-${label.replace(' ', '-')}`,
        note: `Installment ${label} routed to its dedicated repository`,
      });
      await manager.save(leg);
    }
    return unrouted;
  }

  // Called from verifyPurchase's real-money-in branch once `repository`
  // (transaction.toWalletId, already locked) is confirmed open, for a
  // transaction.installmentId (customer's own payInstallment) or
  // .settlesWalletId (admin's initiateOverdueCollectionZarinPal) row:
  // credits the principal share to `repository` — what actually funded the
  // original purchase — and routes fee/penalty/unblockFee to their own
  // dedicated repositories via creditFeeSplitLegs (falling back to
  // `repository` for whichever isn't configured). unblockFee is recovered
  // as transaction.amount minus every installment's own amount, robust
  // regardless of the wallet's current blockedAt state (see payInstallment
  // and initiateOverdueCollectionZarinPal, which fold it into the charge
  // only when the wallet was blocked at charge-creation time).
  private async creditInstallmentRepayment(
    manager: EntityManager,
    transaction: Transaction,
    repository: Wallet,
  ): Promise<void> {
    let installments: Installment[];
    let creditWalletId: string;
    if (transaction.installmentId) {
      const installment = await manager.findOne(Installment, {
        where: { id: transaction.installmentId },
      });
      if (!installment) return;
      installments = [installment];
      creditWalletId = installment.walletId;
    } else {
      creditWalletId = transaction.settlesWalletId!;
      installments =
        await this.installmentsService.getOutstandingForWallet(creditWalletId);
    }

    const { principal, fee, penalty } =
      this.installmentsService.computeRepaymentSplit(installments);
    const unblockFee = BigInt(transaction.amount) - principal - fee - penalty;

    const creditWallet =
      await this.walletsService.getByIdUnscoped(creditWalletId);

    const unrouted = await this.creditFeeSplitLegs(
      manager,
      repository,
      creditWallet.walletType,
      { fee, penalty, unblockFee },
      TransactionType.DEPOSIT,
      `repayment-split:${transaction.id}`,
    );
    const toRepository = principal + unrouted;
    if (toRepository > 0n) {
      await manager.update(Wallet, repository.id, {
        balance: (BigInt(repository.balance) + toRepository).toString(),
      });
    }
  }

  // Overdue-collection method 1 of 3 (see InstallmentsService
  // .applyOverduePenalties for how a wallet ends up blocked in the first
  // place): an admin sends the customer a real ZarinPal payment link for
  // the wallet's entire outstanding balance in one charge. Unlike
  // payInstallment (customer-initiated from inside Packeta, one
  // installment, callback to Packeta's own app), the customer very likely
  // has no active Packeta session when they open a link an admin hands
  // them out of band — so the callback lands on the IPG's own pay page
  // instead, reusing the same topupTxnId query-param mechanism as
  // initiateSupportTopUp. verifyPurchase's settlesWalletId branch marks
  // every outstanding installment paid and clears the block once this
  // verifies.
  async initiateOverdueCollectionZarinPal(
    adminUserId: string,
    walletId: string,
    idempotencyKey: string,
  ): Promise<PurchaseInitiateResult> {
    return this.run(
      'overdue_collect_zarinpal',
      adminUserId,
      { walletId },
      idempotencyKey,
      async (manager) => {
        const { repository, totalOwed } =
          await this.loadOverdueCollectionContext(walletId);

        const timeoutSeconds = DEFAULT_PURCHASE_TIMEOUT_SECONDS;
        const expiresAt = new Date(Date.now() + timeoutSeconds * 1000);

        const transaction = manager.create(Transaction, {
          type: TransactionType.DEPOSIT,
          status: TransactionStatus.PENDING,
          fromWalletId: null,
          toWalletId: repository.id,
          amount: totalOwed.toString(),
          idempotencyKey,
          expiresAt,
          settlesWalletId: walletId,
        });
        await manager.save(transaction);

        // No pre-existing authority to route through (unlike
        // initiateSupportTopUp, which reuses the purchase it's completing)
        // — the transaction's own id works fine as the path segment, since
        // the topupTxnId query param is what actually drives the pay page
        // when present; the route's own :authority is only used for a
        // best-effort, non-critical header fetch there.
        const ipgFrontendUrl = this.configService.get<string>('ipgFrontendUrl');
        const { authority, paymentUrl } =
          await this.zarinpalClientService.createPayment({
            merchantName: 'Overdue installment collection',
            amount: transaction.amount,
            displayAmount: formatAmount(
              totalOwed.toString(),
              repository.walletType.currency,
            ),
            callbackUrl: `${ipgFrontendUrl}/pay/${transaction.id}?topupTxnId=${transaction.id}`,
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

  // Overdue-collection method 2 of 3: the repository owner decides to just
  // absorb the customer's unpaid balance out of the repository's own real
  // funds — no money moves from the customer at all. Debits the
  // repository's real balance for the full outstanding total (rejecting if
  // it can't cover it), records that debit as its own ADJUSTMENT row (the
  // same type the generic admin balance-adjust endpoint uses, since this is
  // functionally the same kind of admin-directed correction, just always
  // tied to a specific overdue wallet), and settles every outstanding
  // installment immediately — no ZarinPal round-trip needed since nothing
  // is pending verification.
  async collectOverdueFromRepository(
    adminUserId: string,
    walletId: string,
    idempotencyKey: string,
  ): Promise<MoneyResult> {
    return this.run(
      'overdue_collect_repository',
      adminUserId,
      { walletId },
      idempotencyKey,
      async (manager) => {
        const { creditWallet, outstanding } =
          await this.loadOverdueCollectionContext(walletId);

        // The principal share was already handed to the customer at
        // purchase time (see settleCreditFundedPurchase) — absorbing the
        // debt means giving up on ever getting that back, not paying it a
        // second time, so only fee/penalty/unblockFee actually move here.
        const { fee, penalty } =
          this.installmentsService.computeRepaymentSplit(outstanding);
        const unblockFee = BigInt(creditWallet.walletType.unblockFee ?? '0');

        const repository = await this.walletsService.lockById(
          manager,
          creditWallet.repositoryWalletId!,
        );

        // Credits whichever of fee/penalty/unblockFee have a dedicated
        // sub-repository configured — whatever's left uncredited
        // (`unrouted`, no destination configured for it) never needs to
        // leave the main repository at all, so only the routed portion gets
        // debited from it below.
        const unrouted = await this.creditFeeSplitLegs(
          manager,
          repository,
          creditWallet.walletType,
          { fee, penalty, unblockFee },
          TransactionType.TRANSFER,
          `overdue-absorb:${idempotencyKey}`,
        );
        const routedTotal = fee + penalty + unblockFee - unrouted;

        const newRepositoryBalance = BigInt(repository.balance) - routedTotal;
        if (newRepositoryBalance < 0n) {
          throw new UnprocessableEntityException(
            "The repository's real balance is not enough to absorb this debt",
          );
        }
        if (routedTotal > 0n) {
          await manager.update(Wallet, repository.id, {
            balance: newRepositoryBalance.toString(),
          });
        }

        const transaction = manager.create(Transaction, {
          type: TransactionType.ADJUSTMENT,
          fromWalletId: repository.id,
          toWalletId: null,
          amount: (fee + penalty + unblockFee).toString(),
          idempotencyKey,
          note: `Overdue collection: repository absorbed the debt for wallet ${walletId} (principal written off; fee/penalty/unblock fee routed to their repositories)`,
          performedByUserId: adminUserId,
        });
        await manager.save(transaction);

        await this.installmentsService.markAllPaidAndUnblock(
          manager,
          walletId,
          transaction.id,
        );

        return {
          transactionId: transaction.id,
          fromWalletId: repository.id,
          toWalletId: null,
          balance: newRepositoryBalance.toString(),
        };
      },
    );
  }

  // Overdue-collection method 3 of 3: the admin confirms the debt was
  // settled by some means outside the system entirely (bank transfer, cash,
  // whatever) — no real balance moves anywhere. The uploaded document is
  // just a filename reference for the audit trail; description +
  // documentReference both fold into the ADJUSTMENT row's note. Every
  // outstanding installment is marked paid on the strength of the admin's
  // confirmation alone.
  async collectOverdueManually(
    adminUserId: string,
    walletId: string,
    description: string,
    documentReference: string | null,
    idempotencyKey: string,
  ): Promise<MoneyResult> {
    return this.run(
      'overdue_collect_manual',
      adminUserId,
      { walletId, description, documentReference },
      idempotencyKey,
      async (manager) => {
        const { totalOwed } = await this.loadOverdueCollectionContext(walletId);

        const note = documentReference
          ? `Overdue collection (manual): ${description} (document: ${documentReference})`
          : `Overdue collection (manual): ${description}`;
        const transaction = manager.create(Transaction, {
          type: TransactionType.ADJUSTMENT,
          fromWalletId: null,
          toWalletId: null,
          amount: totalOwed.toString(),
          idempotencyKey,
          note: note.slice(0, 500),
          performedByUserId: adminUserId,
        });
        await manager.save(transaction);

        await this.installmentsService.markAllPaidAndUnblock(
          manager,
          walletId,
          transaction.id,
        );

        return {
          transactionId: transaction.id,
          fromWalletId: null,
          toWalletId: null,
          balance: '0',
        };
      },
    );
  }

  // Merchant-initiated checkout: unlike initiatePurchase (the customer picks
  // their own wallet up front), here the merchant only names an amount and
  // currency — no customer or wallet is known yet. The resulting pay link is
  // meant to be handed to a customer who isn't logged into Packeta at all;
  // they identify themselves at the IPG via phone + OTP and pick one of
  // their own eligible wallets there (see PurchaseGatewayService), which
  // calls attachPurchaseWallet to fill in fromWalletId before verify can run.
  //
  // explicitWalletId lets a caller who already knows which of the merchant's
  // wallets should receive this charge skip the oldest-eligible auto-pick —
  // used by the admin panel, where an admin creating a charge on a
  // merchant's behalf picks the wallet themselves when there's more than
  // one. currencyCode is ignored when explicitWalletId is given (the
  // wallet's own currency is authoritative).
  async initiateCharge(
    merchantUserId: string,
    amount: number,
    currencyCode: string,
    idempotencyKey: string,
    language?: string,
    settlementSplits?: SettlementSplitDto[],
    explicitWalletId?: string,
    requestContext?: { ip?: string; origin?: string },
  ): Promise<PurchaseInitiateResult> {
    if (settlementSplits) {
      this.settlementService.validateChargeOverrides(settlementSplits, amount);
    }

    return this.run(
      'purchase_charge',
      merchantUserId,
      { amount, currencyCode, language, settlementSplits, explicitWalletId },
      idempotencyKey,
      async (manager) => {
        let toWalletRef: Wallet | null;
        let currency: Awaited<ReturnType<CurrenciesService['findByCode']>>;
        if (explicitWalletId) {
          // getByIdUnscoped loads walletType.currency, unlike the
          // findEligiblePurchaseInWallet path below (which only joins
          // walletType for filtering, not selecting).
          toWalletRef =
            await this.walletsService.getByIdUnscoped(explicitWalletId);
          if (
            toWalletRef.userId !== merchantUserId ||
            !toWalletRef.walletType.allowPurchaseIn ||
            toWalletRef.closedAt
          ) {
            throw new NotFoundException(
              'That wallet cannot receive purchases for this merchant',
            );
          }
          currency = toWalletRef.walletType.currency;
        } else {
          currency = await this.currenciesService.findByCode(currencyCode);
          toWalletRef = await this.walletsService.findEligiblePurchaseInWallet(
            manager,
            merchantUserId,
            currency.id,
          );
          if (!toWalletRef) {
            throw new NotFoundException(
              `You have no ${currency.code} wallet eligible to receive purchases`,
            );
          }
          // Merchant access controls only apply to the merchant's own
          // self-service charge creation (this branch) — an admin creating a
          // charge on a merchant's behalf (explicitWalletId, above) isn't
          // calling from the merchant's own IP/site.
          this.assertMerchantChargeAllowed(toWalletRef, requestContext);
        }
        this.walletsService.assertWithinTransactionLimits(toWalletRef, amount);

        const timeoutSeconds =
          toWalletRef.purchaseTimeoutSeconds ??
          DEFAULT_PURCHASE_TIMEOUT_SECONDS;
        const expiresAt = new Date(Date.now() + timeoutSeconds * 1000);

        const transaction = manager.create(Transaction, {
          type: TransactionType.PURCHASE,
          status: TransactionStatus.PENDING,
          fromWalletId: null,
          toWalletId: toWalletRef.id,
          amount: amount.toString(),
          idempotencyKey,
          expiresAt,
          language: language ?? 'en',
        });
        await manager.save(transaction);

        if (settlementSplits) {
          await this.settlementService.createForTransaction(
            manager,
            transaction.id,
            settlementSplits,
          );
        }

        const merchant = await manager.findOne(User, {
          where: { id: merchantUserId },
        });
        const frontendUrl = this.configService.get<string>('frontendUrl');
        const { authority, paymentUrl } =
          await this.ipgClientService.createPayment({
            merchantName: displayIdentity(merchant!),
            amount: transaction.amount,
            displayAmount: formatAmount(amount, currency),
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

  // Called by PurchaseGatewayService once the customer has proven who they
  // are (phone + OTP) and picked which of their own wallets to pay with.
  // Only fills in a still-empty fromWalletId on a PENDING charge — can't be
  // used to reassign an already-identified purchase.
  async attachPurchaseWallet(
    ipgAuthority: string,
    fromWalletId: string,
  ): Promise<void> {
    await this.transactionsRepository
      .createQueryBuilder()
      .update(Transaction)
      .set({ fromWalletId })
      .where('"ipgAuthority" = :ipgAuthority', { ipgAuthority })
      .andWhere('status = :pending', { pending: TransactionStatus.PENDING })
      .andWhere('"fromWalletId" IS NULL')
      .execute();
  }

  // Step 1 of the credit-shortfall top-up: called once the customer has seen
  // the shortfall and explicitly agreed to pay it (see
  // PurchaseGatewayService.confirmSupportTopUp) — creates a real ZarinPal
  // payment for exactly the shortfall and links it back to the PENDING
  // purchase via completesPurchaseId. Idempotent: a second call while one is
  // already PENDING just hands back the same redirect instead of charging
  // twice. Also extends the purchase's own expiresAt to a full window, since
  // the sandbox-IPG timeout it was created with may be far shorter than what
  // a second, real payment gateway detour actually needs.
  async initiateSupportTopUp(
    purchaseTransactionId: string,
    shortfall: bigint,
  ): Promise<{ redirectUrl: string; topUpTransactionId: string }> {
    return this.dataSource.transaction(async (manager) => {
      const existing = await manager.findOne(Transaction, {
        where: {
          completesPurchaseId: purchaseTransactionId,
          status: TransactionStatus.PENDING,
        },
      });
      if (existing) {
        return {
          redirectUrl: existing.ipgPaymentUrl!,
          topUpTransactionId: existing.id,
        };
      }

      const purchase = await manager.findOne(Transaction, {
        where: { id: purchaseTransactionId },
      });
      if (
        !purchase ||
        purchase.status !== TransactionStatus.PENDING ||
        !purchase.fromWalletId
      ) {
        throw new NotFoundException(
          'Purchase not found, already resolved, or has no wallet attached yet',
        );
      }

      const expiresAt = new Date(
        Date.now() + DEFAULT_PURCHASE_TIMEOUT_SECONDS * 1000,
      );
      await manager.update(Transaction, purchase.id, { expiresAt });

      const creditWallet = await this.walletsService.getByIdUnscoped(
        purchase.fromWalletId,
      );
      const ipgFrontendUrl = this.configService.get<string>('ipgFrontendUrl');

      const topUp = manager.create(Transaction, {
        type: TransactionType.DEPOSIT,
        status: TransactionStatus.PENDING,
        fromWalletId: null,
        toWalletId: null,
        amount: shortfall.toString(),
        idempotencyKey: `support-topup:${purchase.id}`,
        completesPurchaseId: purchase.id,
        expiresAt,
      });
      await manager.save(topUp);

      // Callback lands back on the IPG's own pay page (not Packeta's app —
      // this customer never had a Packeta session) for the same authority,
      // carrying the top-up's own id so it knows to verify it on mount.
      const { authority, paymentUrl } =
        await this.zarinpalClientService.createPayment({
          merchantName: 'Credit top-up',
          amount: topUp.amount,
          displayAmount: formatAmount(
            topUp.amount,
            creditWallet.walletType.currency,
          ),
          callbackUrl: `${ipgFrontendUrl}/pay/${purchase.ipgAuthority}?topupTxnId=${topUp.id}`,
          timeoutSeconds: DEFAULT_PURCHASE_TIMEOUT_SECONDS,
        });

      topUp.ipgAuthority = authority;
      topUp.ipgPaymentUrl = paymentUrl;
      await manager.save(topUp);

      return { redirectUrl: paymentUrl, topUpTransactionId: topUp.id };
    });
  }

  // Used by the purchase gateway to look up a charge's currency/merchant
  // before showing the customer their eligible wallets.
  async findPendingChargeByAuthority(
    ipgAuthority: string,
  ): Promise<Transaction | null> {
    return this.transactionsRepository.findOne({
      where: {
        ipgAuthority,
        status: TransactionStatus.PENDING,
        type: TransactionType.PURCHASE,
      },
    });
  }

  // Used by the IPG pay page to decide, before showing anything else,
  // whether this authority still needs phone+OTP identification and a
  // wallet pick (a charge with no fromWalletId yet) or can go straight to
  // the confirm/cancel screen (a customer-initiated purchase that already
  // had its wallet chosen on Packeta before redirecting).
  async findByIpgAuthority(ipgAuthority: string): Promise<Transaction | null> {
    return this.transactionsRepository.findOne({ where: { ipgAuthority } });
  }

  // Step 2: called once the customer's browser lands back on the callback
  // URL with a successful IPG confirmation. Server-to-server verifies with
  // the IPG (one-time, so a duplicate call is harmless) and only then moves
  // real money — debiting the customer and crediting the merchant.
  // Public/unauthenticated by design: a charge-based purchase's customer
  // never has a Packeta session to present, and there's nothing unsafe about
  // that — this only ever moves money into the wallet that was already fixed
  // at attach-wallet time (itself gated by phone+OTP), and the IPG's own
  // verify call is one-time-use, so an early or duplicate call is harmless.
  async verifyPurchase(transactionId: string): Promise<PurchaseVerifyResult> {
    return this.dataSource.transaction(async (manager) => {
      const transaction = await manager
        .createQueryBuilder(Transaction, 't')
        .setLock('pessimistic_write')
        .where('t.id = :transactionId', { transactionId })
        .andWhere('t.type IN (:...types)', {
          types: [TransactionType.PURCHASE, TransactionType.DEPOSIT],
        })
        .getOne();
      if (!transaction) {
        throw new NotFoundException('Transaction not found');
      }

      // A row with no fromWalletId is either genuinely walletless — a
      // DEPOSIT (credits the depositor's own wallet), an installment
      // repayment (credits the repository), an admin-triggered overdue
      // collection (credits the repository, then settles every outstanding
      // installment on the blocked wallet — see settlesWalletId below), or
      // a credit-shortfall top-up (credits an auto-provisioned support
      // wallet, then completes the purchase it's linked to) — all funded
      // purely by the IPG, with nothing to debit on Packeta's side; or it's
      // a merchant-initiated charge still waiting for the customer to
      // identify themselves and pick a wallet at the IPG (see
      // attachPurchaseWallet), which genuinely can't be verified yet.
      const isSupportTopUp = !!transaction.completesPurchaseId;
      const isRealMoneyIn =
        transaction.type === TransactionType.DEPOSIT ||
        !!transaction.installmentId ||
        isSupportTopUp;
      if (!transaction.fromWalletId && !isRealMoneyIn) {
        throw new UnprocessableEntityException(
          'This purchase has no customer wallet assigned yet — the customer must identify themselves and pick a wallet at the payment page first',
        );
      }

      if (transaction.status === TransactionStatus.COMPLETED) {
        // A repeat call for an already-resolved top-up still needs to hand
        // back the merchant redirect — completeSupportTopUp is idempotent
        // (it only re-credits the support wallet / re-settles the purchase
        // the first time through) — everything else just returns as-is.
        return isSupportTopUp
          ? this.completeSupportTopUp(manager, transaction)
          : { transactionId: transaction.id, status: transaction.status };
      }
      if (transaction.status === TransactionStatus.REVERSED) {
        throw new UnprocessableEntityException(
          'This transaction was reversed and can no longer be verified',
        );
      }

      if (
        transaction.expiresAt &&
        transaction.expiresAt.getTime() < Date.now()
      ) {
        transaction.status = TransactionStatus.REVERSED;
        await manager.save(transaction);
        throw new GoneException(
          'The verification window for this transaction has expired',
        );
      }

      // Deposits and installment repayments are paid through ZarinPal (a
      // real gateway) — see deposit() and payInstallment() above. Every
      // other flow here (regular purchases) still uses the in-house
      // sandbox IPG.
      const verifyClient = isRealMoneyIn
        ? this.zarinpalClientService
        : this.ipgClientService;
      const verifyResult = await verifyClient.verifyPayment(
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

      if (isSupportTopUp) {
        return this.completeSupportTopUp(manager, transaction);
      }

      if (isRealMoneyIn) {
        const toWallet = await this.walletsService.lockById(
          manager,
          transaction.toWalletId!,
        );
        if (toWallet.closedAt) {
          transaction.status = TransactionStatus.REVERSED;
          await manager.save(transaction);
          throw new UnprocessableEntityException(
            'The receiving wallet was closed before this could be verified',
          );
        }
        if (transaction.installmentId || transaction.settlesWalletId) {
          await this.creditInstallmentRepayment(manager, transaction, toWallet);
        } else {
          const newToBalance =
            BigInt(toWallet.balance) + BigInt(transaction.amount);
          await manager.update(Wallet, toWallet.id, {
            balance: newToBalance.toString(),
          });
        }

        transaction.status = TransactionStatus.COMPLETED;
        await manager.save(transaction);

        if (transaction.installmentId) {
          await this.installmentsService.markPaid(
            manager,
            transaction.installmentId,
            transaction.id,
          );
        }
        if (transaction.settlesWalletId) {
          await this.installmentsService.markAllPaidAndUnblock(
            manager,
            transaction.settlesWalletId,
            transaction.id,
          );
        }

        await this.loggingService.log({
          category: 'TRANSACTION',
          action:
            transaction.type === TransactionType.DEPOSIT
              ? 'DEPOSIT_VERIFY'
              : 'PURCHASE_VERIFY',
          success: true,
          metadata: { transactionId: transaction.id },
        });

        return { transactionId: transaction.id, status: transaction.status };
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

      if (fromWallet.closedAt || toWallet.closedAt) {
        transaction.status = TransactionStatus.REVERSED;
        await manager.save(transaction);
        throw new UnprocessableEntityException(
          'One of the wallets for this purchase was closed before it could be verified',
        );
      }

      await this.settleCreditFundedPurchase(
        manager,
        transaction,
        fromWalletRef,
        fromWallet,
        toWallet,
      );

      const merchantWalletRef = await this.walletsService.getByIdUnscoped(
        transaction.toWalletId!,
      );
      this.notifyMerchantCallback(merchantWalletRef, transaction);

      return { transactionId: transaction.id, status: transaction.status };
    });
  }

  // Completes a PURCHASE from a CREDIT wallet, funding it with real money
  // from up to two sources before debiting it and crediting the merchant —
  // exactly like any other wallet's purchase, except the money to spend has
  // to be moved in first:
  //   1. supportFunding, if given (see completeSupportTopUp): a customer
  //      already paid this exact amount via ZarinPal into their own SUPPORT
  //      wallet — pull it into the credit wallet first.
  //   2. Whatever's still needed beyond that (or the whole amount, if there
  //      was no support funding) is drawn from the wallet's linked
  //      REPOSITORY, capped by the remaining credit ceiling
  //      (fromWallet.virtualAmount) — same as before support wallets
  //      existed.
  // Each leg is its own visible TRANSFER into the credit wallet, so the
  // ledger shows exactly where a purchase's money came from.
  private async settleCreditFundedPurchase(
    manager: EntityManager,
    transaction: Transaction,
    fromWalletRef: Wallet,
    fromWallet: Wallet,
    toWallet: Wallet,
    supportFunding?: { supportWallet: Wallet; amount: bigint },
  ): Promise<void> {
    const purchaseAmount = BigInt(transaction.amount);
    let fundedBalance = BigInt(fromWallet.balance);

    if (supportFunding && supportFunding.amount > 0n) {
      const { supportWallet, amount } = supportFunding;
      const newSupportBalance = BigInt(supportWallet.balance) - amount;
      if (newSupportBalance < 0n) {
        // Can't happen in practice — the support wallet was credited this
        // exact amount moments ago in the same DB transaction — but guard
        // it anyway rather than letting a balance go negative silently.
        throw new UnprocessableEntityException(
          'The support wallet does not have enough balance to fund this purchase',
        );
      }
      await manager.update(Wallet, supportWallet.id, {
        balance: newSupportBalance.toString(),
      });
      fundedBalance += amount;
      const supportTransfer = manager.create(Transaction, {
        type: TransactionType.TRANSFER,
        fromWalletId: supportWallet.id,
        toWalletId: fromWallet.id,
        amount: amount.toString(),
        idempotencyKey: `support-fund:${transaction.id}`,
        note: 'Support wallet funded the credit wallet for this purchase',
      });
      await manager.save(supportTransfer);
    }

    const remainder = purchaseAmount - (supportFunding?.amount ?? 0n);
    const isRepositoryBackedCredit =
      fromWalletRef.walletType.code === WalletTypeCode.CREDIT &&
      !!fromWallet.repositoryWalletId;
    if (remainder > 0n && isRepositoryBackedCredit) {
      const availableVirtual = fromWallet.virtualAmount
        ? BigInt(fromWallet.virtualAmount)
        : 0n;
      if (remainder > availableVirtual) {
        transaction.status = TransactionStatus.REVERSED;
        await manager.save(transaction);
        throw new UnprocessableEntityException(
          'This purchase exceeds the remaining credit line on this wallet',
        );
      }

      // Unlike the floor check below, an insufficient-repository-funds
      // rejection here rolls back this whole DB transaction rather than
      // persisting REVERSED — the purchase stays PENDING and the timeout
      // sweep will eventually reverse it. Safe either way (nothing moves on
      // a throw), just less immediate than the floor-check case.
      const repository = await this.walletsService.lockById(
        manager,
        fromWallet.repositoryWalletId!,
      );
      const newRepositoryBalance = BigInt(repository.balance) - remainder;
      if (newRepositoryBalance < 0n) {
        throw new UnprocessableEntityException(
          'The backing repository does not have enough real balance to fund this purchase',
        );
      }

      await manager.update(Wallet, repository.id, {
        balance: newRepositoryBalance.toString(),
      });
      await manager.update(Wallet, fromWallet.id, {
        virtualAmount: (availableVirtual - remainder).toString(),
      });
      fundedBalance += remainder;
      const fundingTransfer = manager.create(Transaction, {
        type: TransactionType.TRANSFER,
        fromWalletId: repository.id,
        toWalletId: fromWallet.id,
        amount: remainder.toString(),
        idempotencyKey: `credit-fund:${transaction.id}`,
        note: 'Repository funded the credit wallet for this purchase',
      });
      await manager.save(fundingTransfer);

      // The real-money leg above is recorded as its own TRANSFER — this is
      // the separate virtualAmount leg: the credit wallet's remaining ceiling
      // shrinking by the same amount it was just drawn on for. Its own
      // VIRTUAL row (not folded into fundingTransfer) so the ledger keeps
      // "real money moved" and "credit ceiling consumed" distinct.
      const ceilingDrawDown = manager.create(Transaction, {
        type: TransactionType.VIRTUAL,
        fromWalletId: fromWallet.id,
        toWalletId: null,
        amount: remainder.toString(),
        idempotencyKey: `credit-draw:${transaction.id}`,
        note: 'Credit wallet ceiling drawn down for this purchase',
        // So InstallmentsService.getSpendBreakdown can trace this period's
        // total back to the merchant the customer actually paid.
        relatedPurchaseId: transaction.id,
      });
      await manager.save(ceilingDrawDown);
    }

    const floor = fromWalletRef.walletType.allowNegativeBalance
      ? -BigInt(fromWalletRef.walletType.creditLimit ?? '0')
      : 0n;
    const newFromBalance = fundedBalance - purchaseAmount;
    if (newFromBalance < floor) {
      transaction.status = TransactionStatus.REVERSED;
      await manager.save(transaction);
      throw new UnprocessableEntityException(
        'Insufficient balance to complete this purchase',
      );
    }
    const newToBalance = BigInt(toWallet.balance) + purchaseAmount;

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
      metadata: { transactionId: transaction.id },
    });
  }

  // Resolves the ZarinPal-verified half of a credit-shortfall top-up (see
  // initiateSupportTopUp): credits the customer's auto-provisioned SUPPORT
  // wallet with the real money that just landed, then immediately spends it
  // — together with whatever the linked credit wallet's repository still
  // covers — to complete the PURCHASE this top-up exists for.
  private async completeSupportTopUp(
    manager: EntityManager,
    topUp: Transaction,
  ): Promise<PurchaseVerifyResult> {
    const purchase = await manager
      .createQueryBuilder(Transaction, 't')
      .setLock('pessimistic_write')
      .where('t.id = :id', { id: topUp.completesPurchaseId })
      .getOne();
    if (!purchase || !purchase.fromWalletId || !purchase.toWalletId) {
      throw new UnprocessableEntityException(
        'The purchase this top-up belongs to is no longer available',
      );
    }

    const fromWalletRef = await this.walletsService.getByIdUnscoped(
      purchase.fromWalletId,
    );
    const orderedIds = [
      purchase.fromWalletId,
      purchase.toWalletId,
      ...(fromWalletRef.repositoryWalletId
        ? [fromWalletRef.repositoryWalletId]
        : []),
    ].sort();
    const locked = new Map<string, Wallet>();
    for (const id of orderedIds) {
      locked.set(id, await this.walletsService.lockById(manager, id));
    }
    const fromWallet = locked.get(purchase.fromWalletId)!;
    const toWallet = locked.get(purchase.toWalletId)!;

    const supportWalletRaw =
      await this.walletsService.findOrCreateSupportWallet(
        manager,
        fromWallet.userId,
        fromWalletRef.walletType.currencyId,
      );
    const supportWallet = await this.walletsService.lockById(
      manager,
      supportWalletRaw.id,
    );

    const topUpAmount = BigInt(topUp.amount);
    // Guards a repeat call (e.g. the top-level COMPLETED short-circuit
    // re-entering here just to rebuild the merchant redirect) from
    // re-crediting the support wallet a second time.
    if (topUp.status !== TransactionStatus.COMPLETED) {
      await manager.update(Wallet, supportWallet.id, {
        balance: (BigInt(supportWallet.balance) + topUpAmount).toString(),
      });
      supportWallet.balance = (
        BigInt(supportWallet.balance) + topUpAmount
      ).toString();
      topUp.toWalletId = supportWallet.id;
      topUp.status = TransactionStatus.COMPLETED;
      await manager.save(topUp);
    }

    const merchantWalletRef = await this.walletsService.getByIdUnscoped(
      purchase.toWalletId,
    );

    if (purchase.status !== TransactionStatus.COMPLETED) {
      if (fromWallet.closedAt || toWallet.closedAt) {
        purchase.status = TransactionStatus.REVERSED;
        await manager.save(purchase);
        throw new UnprocessableEntityException(
          'One of the wallets for this purchase was closed before it could be verified',
        );
      }

      await this.settleCreditFundedPurchase(
        manager,
        purchase,
        fromWalletRef,
        fromWallet,
        toWallet,
        { supportWallet, amount: topUpAmount },
      );
      this.notifyMerchantCallback(merchantWalletRef, purchase);
    }

    // The purchase is settled one way or the other by this point (completed
    // just now, or already completed on a repeat call) — only now does the
    // customer's own browser head back to the merchant.
    const redirectUrl = this.buildMerchantRedirectUrl(
      merchantWalletRef.callbackUrl,
      purchase.id,
      purchase.status,
    );

    return { transactionId: purchase.id, status: purchase.status, redirectUrl };
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

  // Used by the timeout sweep: every PENDING purchase or deposit past its
  // expiresAt, never verified in time.
  async findExpiredPendingPurchases(): Promise<Transaction[]> {
    return this.transactionsRepository.find({
      where: {
        type: In([TransactionType.PURCHASE, TransactionType.DEPOSIT]),
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

  // Public/unauthenticated, same reasoning as verifyPurchase: the customer
  // clicking Cancel on the IPG page may have no Packeta session at all.
  // Scoped strictly to still-PENDING purchases, so it can never touch a
  // COMPLETED one — refunding those still requires reverseTransaction's
  // authenticated ownership check.
  async cancelPendingPurchase(transactionId: string): Promise<void> {
    const result = await this.transactionsRepository
      .createQueryBuilder()
      .update(Transaction)
      .set({ status: TransactionStatus.REVERSED })
      .where('id = :transactionId', { transactionId })
      .andWhere('type IN (:...types)', {
        types: [TransactionType.PURCHASE, TransactionType.DEPOSIT],
      })
      .andWhere('status = :pending', { pending: TransactionStatus.PENDING })
      .execute();
    if (!result.affected) {
      throw new NotFoundException(
        'No pending purchase found with that id — it may already be resolved',
      );
    }
  }

  // Merchant wallet auto-withdraw sweep. System-triggered (the scheduler),
  // so there's no caller to check ownership against and no Idempotency-Key
  // header — each generated WITHDRAW's key is derived from wallet + purchase
  // (+ split index) + minute, so a scheduler tick that somehow fires twice
  // in the same minute doesn't double-withdraw.
  //
  // Two modes, decided per wallet:
  //   - No settlement split configured anywhere for this wallet (no default
  //     accounts, and none of its unsettled purchases carry their own
  //     override): legacy behavior, unchanged — the full balance goes out as
  //     one plain WITHDRAW.
  //   - Otherwise: split-settlement mode. Each still-unsettled COMPLETED
  //     PURCHASE credited to this wallet is paid out individually — using
  //     its own settlementSplits override if the charge supplied one, else
  //     falling back to the wallet's default settlementAccounts, else (an
  //     older purchase with neither) a single plain WITHDRAW for just that
  //     purchase's amount — so a per-charge split can never be diluted by
  //     being aggregated together with other purchases' money.
  //
  // Rail-aware: when the wallet has a Wallet.railType configured (see
  // rail-schedule.ts/SettlementRailSweepService — this is what decides
  // *when* this method gets called, not this method itself), every WITHDRAW
  // this sweep produces also gets a linked RailSettlement row recording
  // which rail (Pol Pay/Paya/Satna/bank transfer) it went out over — the
  // WITHDRAW still carries the actual ledger movement, exactly as it does
  // for a non-rail wallet.
  async sweepAutoWithdraw(walletId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const wallet = await this.walletsService.lockById(manager, walletId);
      if (BigInt(wallet.balance) <= 0n) {
        return;
      }

      const now = new Date();
      const minuteKey = now.toISOString().slice(0, 16);
      const keyPrefix = wallet.railType
        ? `rail-settlement:${wallet.railType.toLowerCase()}`
        : 'auto-withdraw';
      const walletDefaults = await this.settlementService.findForWallet(
        manager,
        wallet.id,
      );

      const recordRailSettlement = async (
        transaction: Transaction,
        amount: string,
        destinationIban: string | null,
        label: string | null,
      ): Promise<void> => {
        if (!wallet.railType) return;
        const settlement = await this.railSettlementsService.createForSweep(
          manager,
          {
            walletId: wallet.id,
            railType: wallet.railType,
            amount,
            destinationIban,
            label,
            transactionId: transaction.id,
            scheduledFor: now,
          },
        );
        await manager.update(Transaction, transaction.id, {
          railSettlementId: settlement.id,
        });
      };

      const unsettledPurchases = await manager
        .createQueryBuilder(Transaction, 't')
        .setLock('pessimistic_write')
        .where('t."toWalletId" = :walletId', { walletId: wallet.id })
        .andWhere('t.type = :type', { type: TransactionType.PURCHASE })
        .andWhere('t.status = :status', {
          status: TransactionStatus.COMPLETED,
        })
        .andWhere('t."settledAt" IS NULL')
        .getMany();

      const overridesByPurchase =
        await this.settlementService.findForTransactions(
          manager,
          unsettledPurchases.map((purchase) => purchase.id),
        );
      const splitModeActive =
        walletDefaults.length > 0 || overridesByPurchase.size > 0;

      if (!splitModeActive) {
        await manager.update(Wallet, wallet.id, { balance: '0' });
        const transaction = manager.create(Transaction, {
          type: TransactionType.WITHDRAW,
          fromWalletId: wallet.id,
          toWalletId: null,
          amount: wallet.balance,
          idempotencyKey: `${keyPrefix}:${wallet.id}:${minuteKey}`,
        });
        await manager.save(transaction);
        await recordRailSettlement(transaction, wallet.balance, null, null);
        return;
      }

      let remainingBalance = BigInt(wallet.balance);

      for (const purchase of unsettledPurchases) {
        const splitRows =
          overridesByPurchase.get(purchase.id) ?? walletDefaults;

        const amounts = splitRows.length
          ? this.settlementService.computeAmounts(splitRows, purchase.amount)
          : [{ iban: null, label: null, amount: BigInt(purchase.amount) }];

        const total = amounts.reduce((sum, item) => sum + item.amount, 0n);
        // Defensive only — every purchase's amount was already added to this
        // wallet's balance at verify time, so this should never trip.
        if (total > remainingBalance) {
          continue;
        }
        remainingBalance -= total;

        for (const [index, item] of amounts.entries()) {
          const withdrawal = manager.create(Transaction, {
            type: TransactionType.WITHDRAW,
            fromWalletId: wallet.id,
            toWalletId: null,
            amount: item.amount.toString(),
            idempotencyKey: `${keyPrefix}:${wallet.id}:${purchase.id}:${index}:${minuteKey}`,
            relatedTransactionId: purchase.id,
            destinationIban: item.iban,
            note: item.label,
          });
          await manager.save(withdrawal);
          await recordRailSettlement(
            withdrawal,
            item.amount.toString(),
            item.iban,
            item.label,
          );
        }

        purchase.settledAt = new Date();
        await manager.save(purchase);
      }

      await manager.update(Wallet, wallet.id, {
        balance: remainingBalance.toString(),
      });
    });
  }

  // A repository-backed CREDIT wallet's own balance/floor mechanics are
  // completely unchanged by this — it only additionally debits the linked
  // REPOSITORY's real balance by the same amount, since that's the real
  // money actually funding the personnel's spend (see
  // WalletsService.grantCredit). No-op for every wallet without a
  // repositoryWalletId. Applies to withdraw/transfer-out only — merchant
  // purchases fund the credit wallet from its repository explicitly, up
  // front, inline in verifyPurchase, rather than through this helper — and
  // admin adjustments/purchase refunds intentionally don't cascade here.
  private async debitLinkedRepository(
    manager: EntityManager,
    fromWalletRef: Wallet,
    amount: bigint,
  ): Promise<void> {
    if (!fromWalletRef.repositoryWalletId) return;

    const repository = await this.walletsService.lockById(
      manager,
      fromWalletRef.repositoryWalletId,
    );
    const newRepositoryBalance = BigInt(repository.balance) - amount;
    if (newRepositoryBalance < 0n) {
      throw new UnprocessableEntityException(
        'The backing repository does not have enough real balance to fund this transaction',
      );
    }
    await manager.update(Wallet, repository.id, {
      balance: newRepositoryBalance.toString(),
    });
  }

  // Best-effort merchant access controls, only enforceable when the caller
  // actually supplies the relevant signal — neither is fatal to skip when
  // absent, since a server-to-server call may carry no Origin/Referer at
  // all, and a wallet with no allowedIps/storeSite configured imposes no
  // restriction of its own (same "opt in to restrict" philosophy as
  // isCounterpartyAllowed).
  private assertMerchantChargeAllowed(
    wallet: Wallet,
    requestContext?: { ip?: string; origin?: string },
  ): void {
    if (wallet.allowedIps?.length) {
      const ip = requestContext?.ip;
      if (!ip || !wallet.allowedIps.includes(ip)) {
        throw new ForbiddenException(
          'This request does not come from an allowed IP for this wallet',
        );
      }
    }

    if (wallet.storeSite && requestContext?.origin) {
      try {
        const requestHost = new URL(requestContext.origin).hostname;
        const storeHost = new URL(wallet.storeSite).hostname;
        if (requestHost !== storeHost) {
          throw new ForbiddenException(
            'This request does not originate from the wallet-registered store site',
          );
        }
      } catch (error) {
        if (error instanceof ForbiddenException) throw error;
        // Malformed Origin/Referer header — ignore rather than block.
      }
    }
  }

  // A wallet frozen by InstallmentsService.applyOverduePenalties can't send
  // any money out (withdraw, transfer, purchase) until the overdue
  // installment is repaid — see payInstallment. Incoming money (deposit,
  // being paid) is unaffected.
  private assertNotBlocked(wallet: { blockedAt: Date | null }): void {
    if (wallet.blockedAt) {
      throw new ForbiddenException(
        'This wallet is blocked pending an overdue installment payment',
      );
    }
  }

  // Fire-and-forget notification to the merchant's own registered webhook
  // once a purchase into this wallet completes — best-effort, never blocks
  // or fails the customer-facing verify response.
  private notifyMerchantCallback(
    wallet: Wallet,
    transaction: Transaction,
  ): void {
    if (!wallet.callbackUrl) return;
    fetch(wallet.callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactionId: transaction.id,
        status: transaction.status,
        amount: transaction.amount,
      }),
    }).catch(() => {
      // Best-effort: the merchant's webhook being unreachable doesn't affect
      // the purchase itself, which has already completed on our ledger.
    });
  }

  // Where the customer's own browser goes back to once a credit-shortfall
  // top-up is resolved (see completeSupportTopUp) — the merchant's own
  // callbackUrl, the same one notifyMerchantCallback posts to server-to-
  // server, just as a browser redirect instead of a webhook. No callbackUrl
  // configured means no redirect target: the caller falls back to showing
  // the result on the IPG's own pay page instead.
  private buildMerchantRedirectUrl(
    callbackUrl: string | null,
    transactionId: string,
    status: TransactionStatus,
  ): string | undefined {
    if (!callbackUrl) return undefined;
    const separator = callbackUrl.includes('?') ? '&' : '?';
    return `${callbackUrl}${separator}transactionId=${transactionId}&status=${status}`;
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
      settledAt: transaction.settledAt,
      destinationIban: transaction.destinationIban,
    };
  }

  // Admin use only: full detail for any transaction, no ownership check,
  // with each wallet's owner attached (the customer-scoped getById above
  // only ever shows the caller their own side).
  async getByIdUnscoped(transactionId: string) {
    const transaction = await this.transactionsRepository.findOne({
      where: { id: transactionId },
    });
    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    const [fromWallet, toWallet] = await Promise.all([
      transaction.fromWalletId
        ? this.walletsService.getByIdWithOwner(transaction.fromWalletId)
        : null,
      transaction.toWalletId
        ? this.walletsService.getByIdWithOwner(transaction.toWalletId)
        : null,
    ]);

    return {
      id: transaction.id,
      type: transaction.type,
      amount: transaction.amount,
      note: transaction.note,
      idempotencyKey: transaction.idempotencyKey,
      createdAt: transaction.createdAt,
      fromWallet: fromWallet
        ? {
            ...serializeWallet(fromWallet),
            ownerId: fromWallet.user.id,
            ownerEmail: fromWallet.user.email,
            ownerPhoneNumber: fromWallet.user.phoneNumber,
          }
        : null,
      toWallet: toWallet
        ? {
            ...serializeWallet(toWallet),
            ownerId: toWallet.user.id,
            ownerEmail: toWallet.user.email,
            ownerPhoneNumber: toWallet.user.phoneNumber,
          }
        : null,
      status: transaction.status,
      expiresAt: transaction.expiresAt,
      relatedTransactionId: transaction.relatedTransactionId,
      settledAt: transaction.settledAt,
      destinationIban: transaction.destinationIban,
      performedByUserId: transaction.performedByUserId,
    };
  }

  private async run<T>(
    action:
      | 'deposit'
      | 'withdraw'
      | 'transfer'
      | 'adjustment'
      | 'purchase_initiate'
      | 'purchase_charge'
      | 'purchase_reverse'
      | 'installment_pay'
      | 'overdue_collect_zarinpal'
      | 'overdue_collect_repository'
      | 'overdue_collect_manual',
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
