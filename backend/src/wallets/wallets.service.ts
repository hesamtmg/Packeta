import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Wallet } from './entities/wallet.entity';
import { WalletType } from '../wallet-types/entities/wallet-type.entity';

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
  ) {}

  async createForUser(
    manager: EntityManager,
    userId: string,
    walletTypeId: string,
    options?: {
      autoWithdrawTimes?: string[];
      purchaseTimeoutSeconds?: number;
    },
  ): Promise<Wallet> {
    const wallet = manager.create(Wallet, {
      userId,
      walletTypeId,
      balance: '0',
      autoWithdrawTimes: options?.autoWithdrawTimes ?? null,
      purchaseTimeoutSeconds: options?.purchaseTimeoutSeconds ?? null,
    });
    return manager.save(wallet);
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
