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
import { WalletType } from '../wallet-types/entities/wallet-type.entity';
import { SettlementService } from '../settlement/settlement.service';
import { SettlementAccountDto } from '../settlement/dto/settlement-account.dto';

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
  ) {}

  async createForUser(
    manager: EntityManager,
    userId: string,
    walletTypeId: string,
    options?: {
      autoWithdrawTimes?: string[];
      purchaseTimeoutSeconds?: number;
      settlementAccounts?: SettlementAccountDto[];
      restrictedCounterparties?: string[];
      terminalId?: string;
      acceptorCode?: string;
    },
  ): Promise<Wallet> {
    const wallet = manager.create(Wallet, {
      userId,
      walletTypeId,
      balance: '0',
      autoWithdrawTimes: options?.autoWithdrawTimes ?? null,
      purchaseTimeoutSeconds: options?.purchaseTimeoutSeconds ?? null,
      restrictedCounterparties: options?.restrictedCounterparties ?? null,
      terminalId: options?.terminalId ?? null,
      acceptorCode: options?.acceptorCode ?? null,
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
      autoWithdrawTimes?: string[];
      purchaseTimeoutSeconds?: number;
      settlementAccounts?: SettlementAccountDto[];
      restrictedCounterparties?: string[];
      terminalId?: string;
      acceptorCode?: string;
    },
  ): Promise<Wallet> {
    const wallet = await this.getById(userId, walletId);
    if (wallet.closedAt) {
      throw new BadRequestException('This wallet is closed');
    }

    const patch: Partial<Wallet> = {};
    if (options.autoWithdrawTimes !== undefined) {
      patch.autoWithdrawTimes = options.autoWithdrawTimes.length
        ? options.autoWithdrawTimes
        : null;
    }
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
  async listWithAutoWithdrawDue(): Promise<Wallet[]> {
    return this.walletsRepository
      .createQueryBuilder('wallet')
      .innerJoinAndSelect('wallet.walletType', 'walletType')
      .innerJoinAndSelect('walletType.currency', 'currency')
      .where('walletType.supportsAutoWithdraw = true')
      .andWhere('wallet.autoWithdrawTimes IS NOT NULL')
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
