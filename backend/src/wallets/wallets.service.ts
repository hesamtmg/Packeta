import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Wallet } from './entities/wallet.entity';
import { WalletType } from '../wallet-types/entities/wallet-type.entity';

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
  ): Promise<Wallet> {
    const wallet = manager.create(Wallet, {
      userId,
      walletTypeId,
      balance: '0',
    });
    return manager.save(wallet);
  }

  // Gives every new user one wallet of each currently-known type as a
  // starting set; they can create additional wallets of any type afterwards.
  async createDefaultWalletsForUser(
    manager: EntityManager,
    userId: string,
  ): Promise<Wallet[]> {
    const types = await manager.find(WalletType);
    const wallets = types.map((type) =>
      manager.create(Wallet, { userId, walletTypeId: type.id, balance: '0' }),
    );
    return manager.save(wallets);
  }

  async listForUser(userId: string): Promise<Wallet[]> {
    return this.walletsRepository.find({
      where: { userId },
      relations: { walletType: true },
      order: { createdAt: 'ASC' },
    });
  }

  async getById(userId: string, walletId: string): Promise<Wallet> {
    const wallet = await this.walletsRepository.findOne({
      where: { id: walletId },
      relations: { walletType: true },
    });
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }
    if (wallet.userId !== userId) {
      throw new ForbiddenException('This wallet does not belong to you');
    }
    return wallet;
  }

  // Any wallet of the given type that is eligible to receive a peer-to-peer
  // transfer, oldest first — the recipient's own choice of which specific
  // wallet to expose is not something the sender gets to pick.
  async findEligibleP2pInWallet(
    manager: EntityManager,
    userId: string,
  ): Promise<Wallet | null> {
    return manager
      .createQueryBuilder(Wallet, 'wallet')
      .innerJoin('wallet.walletType', 'walletType')
      .where('wallet.userId = :userId', { userId })
      .andWhere('walletType.allowP2pIn = true')
      .orderBy('wallet.createdAt', 'ASC')
      .getOne();
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
