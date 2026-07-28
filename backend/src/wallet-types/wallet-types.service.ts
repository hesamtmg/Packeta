import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WalletType } from './entities/wallet-type.entity';

@Injectable()
export class WalletTypesService {
  constructor(
    @InjectRepository(WalletType)
    private readonly walletTypesRepository: Repository<WalletType>,
  ) {}

  findAll(): Promise<WalletType[]> {
    return this.walletTypesRepository.find({ order: { name: 'ASC' } });
  }

  async findByCode(code: string): Promise<WalletType> {
    const type = await this.walletTypesRepository.findOne({ where: { code } });
    if (!type) {
      throw new NotFoundException(`Unknown wallet type "${code}"`);
    }
    return type;
  }

  async findById(id: string): Promise<WalletType> {
    const type = await this.walletTypesRepository.findOne({ where: { id } });
    if (!type) {
      throw new NotFoundException('Wallet type not found');
    }
    return type;
  }
}
