import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Wallet } from './entities/wallet.entity';
import {
  WalletType,
  WalletTypeCode,
} from '../wallet-types/entities/wallet-type.entity';
import { WalletTypesService } from '../wallet-types/wallet-types.service';
import { SettlementService } from '../settlement/settlement.service';
import { SettlementAccountDto } from '../settlement/dto/settlement-account.dto';
import { UsersService } from '../users/users.service';
import { SettlementRailType } from '../rail-settlements/entities/rail-settlement.entity';
import { IdempotencyService } from '../idempotency/idempotency.service';
import {
  Transaction,
  TransactionType,
} from '../transactions/entities/transaction.entity';
import { serializeWallet } from './wallet.serializer';

const WALLET_RELATIONS = { walletType: { currency: true } } as const;
const WALLET_RELATIONS_WITH_OWNER = {
  walletType: { currency: true },
  user: true,
} as const;

@Injectable()
export class WalletsService {
  constructor(
    @InjectRepository(Wallet)
    private readonly walletsRepository: Repository<Wallet>,
    private readonly settlementService: SettlementService,
    private readonly walletTypesService: WalletTypesService,
    private readonly usersService: UsersService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async createForUser(
    manager: EntityManager,
    userId: string,
    walletTypeId: string,
    options?: {
      purchaseTimeoutSeconds?: number;
      settlementAccounts?: SettlementAccountDto[];
      restrictedCounterparties?: string[];
      terminalId?: string;
      acceptorCode?: string;
      minTransactionAmount?: number;
      maxTransactionAmount?: number;
      storeName?: string;
      storeSite?: string;
      allowedIps?: string[];
      callbackUrl?: string;
      category?: string;
      subCategory?: string;
      virtualAmount?: number;
      nationalCode?: string;
      railType?: SettlementRailType;
      railScheduleTimes?: string[];
    },
  ): Promise<Wallet> {
    this.assertValidLimits(
      options?.minTransactionAmount,
      options?.maxTransactionAmount,
    );
    this.assertValidRailConfig(options?.railType, options?.railScheduleTimes);

    const wallet = manager.create(Wallet, {
      userId,
      walletTypeId,
      balance: '0',
      purchaseTimeoutSeconds: options?.purchaseTimeoutSeconds ?? null,
      restrictedCounterparties: options?.restrictedCounterparties ?? null,
      terminalId: options?.terminalId ?? null,
      acceptorCode: options?.acceptorCode ?? null,
      minTransactionAmount: options?.minTransactionAmount?.toString() ?? null,
      maxTransactionAmount: options?.maxTransactionAmount?.toString() ?? null,
      storeName: options?.storeName ?? null,
      storeSite: options?.storeSite ?? null,
      allowedIps: options?.allowedIps ?? null,
      callbackUrl: options?.callbackUrl ?? null,
      category: options?.category ?? null,
      subCategory: options?.subCategory ?? null,
      virtualAmount: options?.virtualAmount?.toString() ?? null,
      nationalCode: options?.nationalCode ?? null,
      railType: options?.railType ?? null,
      railScheduleTimes: options?.railScheduleTimes ?? null,
    });
    await manager.save(wallet);

    if (options?.settlementAccounts?.length) {
      await this.settlementService.createForWallet(
        manager,
        wallet.id,
        options.settlementAccounts,
      );
    }

    return wallet;
  }

  // Applies a partial update in place — only fields present in `options` are
  // touched. settlementAccounts, when provided, fully replaces the wallet's
  // existing default split (delete-then-recreate, same as at creation).
  async updateForUser(
    manager: EntityManager,
    userId: string,
    walletId: string,
    options: {
      purchaseTimeoutSeconds?: number;
      settlementAccounts?: SettlementAccountDto[];
      restrictedCounterparties?: string[];
      terminalId?: string;
      acceptorCode?: string;
      minTransactionAmount?: number;
      maxTransactionAmount?: number;
      storeName?: string;
      storeSite?: string;
      allowedIps?: string[];
      callbackUrl?: string;
      category?: string;
      subCategory?: string;
      virtualAmount?: number;
      nationalCode?: string;
      railType?: SettlementRailType;
      railScheduleTimes?: string[];
    },
  ): Promise<Wallet> {
    const wallet = await this.getById(userId, walletId);
    if (wallet.closedAt) {
      throw new BadRequestException('This wallet is closed');
    }

    this.assertValidLimits(
      options.minTransactionAmount !== undefined
        ? options.minTransactionAmount
        : wallet.minTransactionAmount
          ? Number(wallet.minTransactionAmount)
          : undefined,
      options.maxTransactionAmount !== undefined
        ? options.maxTransactionAmount
        : wallet.maxTransactionAmount
          ? Number(wallet.maxTransactionAmount)
          : undefined,
    );
    this.assertValidRailConfig(
      options.railType !== undefined ? options.railType : wallet.railType,
      options.railScheduleTimes !== undefined
        ? options.railScheduleTimes
        : wallet.railScheduleTimes,
    );

    const patch: Partial<Wallet> = {};
    if (options.purchaseTimeoutSeconds !== undefined) {
      patch.purchaseTimeoutSeconds = options.purchaseTimeoutSeconds;
    }
    if (options.restrictedCounterparties !== undefined) {
      patch.restrictedCounterparties = options.restrictedCounterparties.length
        ? options.restrictedCounterparties
        : null;
    }
    if (options.terminalId !== undefined) {
      patch.terminalId = options.terminalId.length ? options.terminalId : null;
    }
    if (options.acceptorCode !== undefined) {
      patch.acceptorCode = options.acceptorCode.length
        ? options.acceptorCode
        : null;
    }
    if (options.minTransactionAmount !== undefined) {
      patch.minTransactionAmount = options.minTransactionAmount.toString();
    }
    if (options.maxTransactionAmount !== undefined) {
      patch.maxTransactionAmount = options.maxTransactionAmount.toString();
    }
    if (options.storeName !== undefined) {
      patch.storeName = options.storeName.length ? options.storeName : null;
    }
    if (options.storeSite !== undefined) {
      patch.storeSite = options.storeSite.length ? options.storeSite : null;
    }
    if (options.allowedIps !== undefined) {
      patch.allowedIps = options.allowedIps.length ? options.allowedIps : null;
    }
    if (options.callbackUrl !== undefined) {
      patch.callbackUrl = options.callbackUrl.length
        ? options.callbackUrl
        : null;
    }
    if (options.category !== undefined) {
      patch.category = options.category.length ? options.category : null;
    }
    if (options.subCategory !== undefined) {
      patch.subCategory = options.subCategory.length
        ? options.subCategory
        : null;
    }
    if (options.virtualAmount !== undefined) {
      patch.virtualAmount = options.virtualAmount.toString();
    }
    if (options.nationalCode !== undefined) {
      patch.nationalCode = options.nationalCode.length
        ? options.nationalCode
        : null;
    }
    if (options.railType !== undefined) {
      patch.railType = options.railType;
    }
    if (options.railScheduleTimes !== undefined) {
      patch.railScheduleTimes = options.railScheduleTimes.length
        ? options.railScheduleTimes
        : null;
    }
    if (Object.keys(patch).length) {
      await manager.update(Wallet, walletId, patch);
    }

    if (options.settlementAccounts !== undefined) {
      await this.settlementService.replaceForWallet(
        manager,
        walletId,
        options.settlementAccounts,
      );
    }

    // Read back through the same transactional manager used for the writes
    // above — this.getById would go through the pool's own connection and,
    // since the writes haven't committed yet, could read pre-update data.
    const updated = await manager.findOne(Wallet, {
      where: { id: walletId },
      relations: WALLET_RELATIONS,
    });
    return updated!;
  }

  // A repository owner splits off a slice of their unallocated virtual pool
  // (repository.virtualAmount) into a brand-new CREDIT wallet for an
  // existing user (looked up by phone — personnel must already have an
  // account, same as every other wallet). The grant decrements the
  // repository's pool by the same amount and links the new wallet back to
  // it via repositoryWalletId, and records the movement as a Transaction so
  // it shows up in the ledger like every other money movement. Doesn't touch
  // anyone's real balance — that only happens once the credit wallet is
  // actually spent from.
  async grantCredit(
    manager: EntityManager,
    ownerUserId: string,
    dto: {
      repositoryWalletId: string;
      personnelPhoneNumber: string;
      walletTypeId: string;
      virtualAmount: number;
      nationalCode?: string;
    },
    idempotencyKey: string,
  ): Promise<Record<string, any>> {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    const claim = await this.idempotencyService.claim(manager, {
      key: idempotencyKey,
      userId: ownerUserId,
      endpoint: 'wallets.credit-grant',
      payload: dto,
    });
    if (claim.replay) {
      return claim.responseBody;
    }

    const repository = await this.getById(ownerUserId, dto.repositoryWalletId);
    if (repository.walletType.code !== WalletTypeCode.REPOSITORY) {
      throw new BadRequestException('That wallet is not a repository');
    }
    if (repository.closedAt) {
      throw new BadRequestException('This repository wallet is closed');
    }

    const walletType = await this.walletTypesService.findById(dto.walletTypeId);
    if (walletType.code !== WalletTypeCode.CREDIT) {
      throw new BadRequestException(
        'A repository can only grant credit to a CREDIT-type wallet',
      );
    }
    if (walletType.currencyId !== repository.walletType.currencyId) {
      throw new BadRequestException(
        "The credit wallet's currency must match the repository's currency",
      );
    }

    const personnel = await this.usersService.findByPhoneNumber(
      dto.personnelPhoneNumber,
    );
    if (!personnel) {
      throw new NotFoundException('No account found with that phone number');
    }

    // Locked right before the pool check/mutation (rather than off the
    // earlier unlocked `repository` read) so two concurrent grants against
    // the same repository can't both read the same pool and double-spend
    // it — the second grant blocks here until the first commits.
    const lockedRepository = await this.lockById(manager, repository.id);
    const availablePool = lockedRepository.virtualAmount
      ? BigInt(lockedRepository.virtualAmount)
      : 0n;
    const requested = BigInt(dto.virtualAmount);
    if (requested > availablePool) {
      throw new UnprocessableEntityException(
        'This repository does not have enough unallocated virtual balance for that amount',
      );
    }

    const creditWallet = await this.createForUser(
      manager,
      personnel.id,
      walletType.id,
      {
        virtualAmount: dto.virtualAmount,
        nationalCode: dto.nationalCode,
      },
    );
    // The grant preloads the wallet's spendable balance up to its ceiling —
    // virtualAmount stays the fixed ceiling this wallet was granted, while
    // balance is what's actually left to spend right now (drawn down by
    // ordinary spends, same as any other wallet's balance).
    await manager.update(Wallet, creditWallet.id, {
      repositoryWalletId: repository.id,
      balance: requested.toString(),
    });
    await manager.update(Wallet, repository.id, {
      virtualAmount: (availablePool - requested).toString(),
    });

    // Not a real-money transfer (nothing moves between fromWalletId's and
    // toWalletId's spendable `balance` — the credit wallet's balance was
    // already preloaded above), but it's still a virtual-pool movement worth
    // a ledger entry so it's visible in the repository owner's and
    // personnel's transaction history like any other movement.
    const transaction = manager.create(Transaction, {
      type: TransactionType.TRANSFER,
      fromWalletId: repository.id,
      toWalletId: creditWallet.id,
      amount: requested.toString(),
      idempotencyKey,
      note: 'Credit grant: repository virtual balance -> credit wallet',
    });
    await manager.save(transaction);

    const updated = await manager.findOne(Wallet, {
      where: { id: creditWallet.id },
      relations: WALLET_RELATIONS,
    });
    const responseBody = serializeWallet(updated!);
    await this.idempotencyService.complete(
      manager,
      idempotencyKey,
      responseBody,
    );
    return responseBody;
  }

  // Soft-close: a wallet with any transaction history can't be hard-deleted
  // (transactions reference it by FK, and are themselves permanent), so
  // "deleting" a wallet just marks it closed instead. Only allowed at a zero
  // balance, so no funds are ever stranded.
  async closeForUser(userId: string, walletId: string): Promise<Wallet> {
    const wallet = await this.getById(userId, walletId);
    if (wallet.closedAt) {
      throw new BadRequestException('This wallet is already closed');
    }
    if (BigInt(wallet.balance) !== 0n) {
      throw new UnprocessableEntityException(
        'Withdraw or transfer out the remaining balance before closing this wallet',
      );
    }
    await this.walletsRepository.update(walletId, { closedAt: new Date() });
    return this.getById(userId, walletId);
  }

  // Admin-only counterpart to closeForUser: reopens a wallet a customer
  // closed themselves (or that was closed in error), clearing closedAt so
  // it's usable again. No ownership check — same reasoning as
  // getByIdUnscoped, the caller is explicitly allowed to act on any wallet.
  async reopenAsAdmin(walletId: string): Promise<Wallet> {
    const wallet = await this.getByIdUnscoped(walletId);
    if (!wallet.closedAt) {
      throw new BadRequestException('This wallet is not closed');
    }
    await this.walletsRepository.update(walletId, { closedAt: null });
    return this.getByIdUnscoped(walletId);
  }

  // Rejects a min/max pair where both are set and min exceeds max — checked
  // whenever either bound changes, using the other's current value when only
  // one side of the pair is being updated.
  private assertValidLimits(min?: number, max?: number): void {
    if (min !== undefined && max !== undefined && min > max) {
      throw new BadRequestException(
        'minTransactionAmount cannot be greater than maxTransactionAmount',
      );
    }
  }

  // BANK_TRANSFER has no built-in default schedule (see
  // RAIL_DEFAULT_SCHEDULE_TIMES) — a direct bank transfer's timing is
  // entirely bank-specific, so a wallet choosing that rail must supply its
  // own railScheduleTimes explicitly. Every other rail is fine unconfigured
  // (falls back to its built-in default at sweep time).
  private assertValidRailConfig(
    railType?: SettlementRailType | null,
    scheduleTimes?: string[] | null,
  ): void {
    if (
      railType === SettlementRailType.BANK_TRANSFER &&
      !scheduleTimes?.length
    ) {
      throw new BadRequestException(
        'BANK_TRANSFER has no default schedule — railScheduleTimes must be set explicitly for this wallet',
      );
    }
  }

  // Every wallet may configure an optional per-transaction amount band
  // (minor units) — used by TransactionsService wherever an amount is about
  // to move into or out of a wallet.
  assertWithinTransactionLimits(wallet: Wallet, amount: number | bigint): void {
    const value = typeof amount === 'bigint' ? amount : BigInt(amount);
    if (
      wallet.minTransactionAmount !== null &&
      value < BigInt(wallet.minTransactionAmount)
    ) {
      throw new UnprocessableEntityException(
        `This wallet requires a minimum transaction amount of ${wallet.minTransactionAmount}`,
      );
    }
    if (
      wallet.maxTransactionAmount !== null &&
      value > BigInt(wallet.maxTransactionAmount)
    ) {
      throw new UnprocessableEntityException(
        `This wallet allows a maximum transaction amount of ${wallet.maxTransactionAmount}`,
      );
    }
  }

  // "Either side's own list is enough": if a wallet has no restriction list
  // at all, it imposes no restriction of its own — but if it does, that list
  // alone is sufficient to allow the pairing regardless of what the other
  // side's list says (so setting a restriction never blocks a pairing the
  // *other* side already opted into). It only blocks when at least one side
  // has a list configured and neither list actually contains the other
  // party's email.
  isCounterpartyAllowed(
    walletARestrictions: string[] | null,
    emailB: string,
    walletBRestrictions: string[] | null,
    emailA: string,
  ): boolean {
    const aHasList = !!walletARestrictions?.length;
    const bHasList = !!walletBRestrictions?.length;
    if (!aHasList && !bHasList) return true;
    if (aHasList && walletARestrictions!.includes(emailB)) return true;
    if (bHasList && walletBRestrictions!.includes(emailA)) return true;
    return false;
  }

  // Merchant wallets whose type supports the auto-withdraw sweep and have a
  // schedule configured. Used by the scheduler to find sweep candidates.
  // Excludes wallets with a rail configured (Wallet.railType) — those are
  // swept on their rail's own schedule instead (see
  // listWithRailSettlementDue), never both.
  async listWithAutoWithdrawDue(): Promise<Wallet[]> {
    return this.walletsRepository
      .createQueryBuilder('wallet')
      .innerJoinAndSelect('wallet.walletType', 'walletType')
      .innerJoinAndSelect('walletType.currency', 'currency')
      .where('walletType.supportsAutoWithdraw = true')
      .andWhere('walletType.autoWithdrawTimes IS NOT NULL')
      .andWhere('wallet."railType" IS NULL')
      .andWhere('wallet.balance <> 0')
      .andWhere('wallet.closedAt IS NULL')
      .getMany();
  }

  // Merchant wallets configured with a withdrawal-schedule rail (Pol Pay /
  // Paya / Satna / bank transfer). Used by SettlementRailSweepService to
  // find sweep candidates — the actual "is it this rail's window right now"
  // check happens in the scheduler, same division of labor as
  // listWithAutoWithdrawDue.
  async listWithRailSettlementDue(): Promise<Wallet[]> {
    return this.walletsRepository
      .createQueryBuilder('wallet')
      .innerJoinAndSelect('wallet.walletType', 'walletType')
      .innerJoinAndSelect('walletType.currency', 'currency')
      .where('walletType.supportsAutoWithdraw = true')
      .andWhere('wallet."railType" IS NOT NULL')
      .andWhere('wallet.balance <> 0')
      .andWhere('wallet.closedAt IS NULL')
      .getMany();
  }

  // Gives every new user one wallet of each type denominated in the default
  // currency (USD) as a starting set; they can create additional wallets —
  // in any currency the admin has made available — afterwards. Adding a new
  // currency's wallet types therefore never changes what existing or new
  // users get by default.
  async createDefaultWalletsForUser(
    manager: EntityManager,
    userId: string,
  ): Promise<Wallet[]> {
    const types = await manager.find(WalletType, {
      relations: { currency: true },
      where: { currency: { isDefault: true }, isStarterType: true },
    });
    const wallets = types.map((type) =>
      manager.create(Wallet, { userId, walletTypeId: type.id, balance: '0' }),
    );
    return manager.save(wallets);
  }

  async listForUser(userId: string): Promise<Wallet[]> {
    return this.walletsRepository.find({
      where: { userId },
      relations: WALLET_RELATIONS,
      order: { createdAt: 'ASC' },
    });
  }

  async getById(userId: string, walletId: string): Promise<Wallet> {
    const wallet = await this.walletsRepository.findOne({
      where: { id: walletId },
      relations: WALLET_RELATIONS,
    });
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }
    if (wallet.userId !== userId) {
      throw new ForbiddenException('This wallet does not belong to you');
    }
    return wallet;
  }

  // Admin use only: every wallet in the system, with its owner attached.
  async listAll(): Promise<Wallet[]> {
    return this.walletsRepository.find({
      relations: WALLET_RELATIONS_WITH_OWNER,
      order: { createdAt: 'DESC' },
    });
  }

  // No ownership check — for admin use only, where the caller is explicitly
  // allowed to act on any user's wallet.
  async getByIdUnscoped(walletId: string): Promise<Wallet> {
    const wallet = await this.walletsRepository.findOne({
      where: { id: walletId },
      relations: WALLET_RELATIONS,
    });
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }
    return wallet;
  }

  // Same as getByIdUnscoped but with the owner attached — for admin detail
  // views that need to show whose wallet this is.
  async getByIdWithOwner(walletId: string): Promise<Wallet> {
    const wallet = await this.walletsRepository.findOne({
      where: { id: walletId },
      relations: WALLET_RELATIONS_WITH_OWNER,
    });
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }
    return wallet;
  }

  // Any wallet of the given currency that is eligible to receive a
  // peer-to-peer transfer, oldest first — the recipient's own choice of
  // which specific wallet to expose is not something the sender gets to
  // pick. Scoping to the sender's currency keeps transfers same-currency
  // only, since there's no exchange-rate conversion.
  async findEligibleP2pInWallet(
    manager: EntityManager,
    userId: string,
    currencyId: string,
  ): Promise<Wallet | null> {
    return manager
      .createQueryBuilder(Wallet, 'wallet')
      .innerJoin('wallet.walletType', 'walletType')
      .where('wallet.userId = :userId', { userId })
      .andWhere('walletType.allowP2pIn = true')
      .andWhere('walletType.currencyId = :currencyId', { currencyId })
      .andWhere('wallet.closedAt IS NULL')
      .orderBy('wallet.createdAt', 'ASC')
      .getOne();
  }

  // Same idea as findEligibleP2pInWallet, but for PURCHASE: resolves the
  // merchant's oldest wallet whose type accepts purchases, in the payer's
  // currency. The customer never sees or picks a merchant's specific wallet
  // id directly.
  async findEligiblePurchaseInWallet(
    manager: EntityManager,
    merchantUserId: string,
    currencyId: string,
  ): Promise<Wallet | null> {
    return manager
      .createQueryBuilder(Wallet, 'wallet')
      .innerJoin('wallet.walletType', 'walletType')
      .where('wallet.userId = :merchantUserId', { merchantUserId })
      .andWhere('walletType.allowPurchaseIn = true')
      .andWhere('walletType.currencyId = :currencyId', { currencyId })
      .andWhere('wallet.closedAt IS NULL')
      .orderBy('wallet.createdAt', 'ASC')
      .getOne();
  }

  // Every wallet a customer could pay a given purchase's merchant from —
  // used by the purchase gateway (phone+OTP flow) to show the customer their
  // own choices at the IPG, rather than resolving just one automatically the
  // way a P2P transfer or a wallet-preselected purchase does.
  async listPurchaseEligibleWallets(
    userId: string,
    currencyId: string,
  ): Promise<Wallet[]> {
    return this.walletsRepository
      .createQueryBuilder('wallet')
      .innerJoinAndSelect('wallet.walletType', 'walletType')
      .innerJoinAndSelect('walletType.currency', 'currency')
      .where('wallet.userId = :userId', { userId })
      .andWhere('walletType.allowPurchaseOut = true')
      .andWhere('walletType.currencyId = :currencyId', { currencyId })
      .andWhere('wallet.closedAt IS NULL')
      .orderBy('wallet.createdAt', 'ASC')
      .getMany();
  }

  // Admin use only: every not-closed wallet of this user that can receive
  // purchases, across all currencies — used by the admin panel's "create a
  // charge on this merchant's behalf" flow, where the admin (not the
  // merchant) needs to see and choose among all of them rather than having
  // one auto-picked for a single currency.
  async listMerchantEligibleWallets(userId: string): Promise<Wallet[]> {
    return this.walletsRepository
      .createQueryBuilder('wallet')
      .innerJoinAndSelect('wallet.walletType', 'walletType')
      .innerJoinAndSelect('walletType.currency', 'currency')
      .where('wallet.userId = :userId', { userId })
      .andWhere('walletType.allowPurchaseIn = true')
      .andWhere('wallet.closedAt IS NULL')
      .orderBy('wallet.createdAt', 'ASC')
      .getMany();
  }

  // Locks the wallet row for the duration of the caller's DB transaction.
  // Must only be called with a manager that is inside an active transaction.
  async lockById(manager: EntityManager, walletId: string): Promise<Wallet> {
    const wallet = await manager
      .createQueryBuilder(Wallet, 'wallet')
      .setLock('pessimistic_write')
      .where('wallet.id = :walletId', { walletId })
      .getOne();
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }
    return wallet;
  }
}
