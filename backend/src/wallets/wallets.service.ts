import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Wallet } from './entities/wallet.entity';

@Injectable()
export class WalletsService {
  constructor(
    @InjectRepository(Wallet)
    private readonly walletsRepository: Repository<Wallet>,
  ) {}

  async createForUser(manager: EntityManager, userId: string): Promise<Wallet> {
    const wallet = manager.create(Wallet, { userId, balance: '0' });
    return manager.save(wallet);
  }

  async getByUserId(userId: string): Promise<Wallet> {
    const wallet = await this.walletsRepository.findOne({ where: { userId } });
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }
    return wallet;
  }

  // Locks the wallet row for the duration of the caller's DB transaction.
  // Must only be called with a manager that is inside an active transaction.
  async lockByUserId(manager: EntityManager, userId: string): Promise<Wallet> {
    const wallet = await manager
      .createQueryBuilder(Wallet, 'wallet')
      .setLock('pessimistic_write')
      .where('wallet.userId = :userId', { userId })
      .getOne();
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }
    return wallet;
  }

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
