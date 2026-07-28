import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WalletType } from './entities/wallet-type.entity';
import { CreateWalletTypeDto } from './dto/create-wallet-type.dto';
import { UpdateWalletTypeDto } from './dto/update-wallet-type.dto';

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

  async create(dto: CreateWalletTypeDto): Promise<WalletType> {
    const existing = await this.walletTypesRepository.findOne({
      where: { code: dto.code },
    });
    if (existing) {
      throw new ConflictException(`Wallet type "${dto.code}" already exists`);
    }
    if (dto.allowNegativeBalance && dto.creditLimit === undefined) {
      throw new BadRequestException(
        'creditLimit is required when allowNegativeBalance is true',
      );
    }

    const type = this.walletTypesRepository.create({
      code: dto.code,
      name: dto.name,
      allowNegativeBalance: dto.allowNegativeBalance,
      creditLimit: dto.allowNegativeBalance ? String(dto.creditLimit) : null,
      allowWithdraw: dto.allowWithdraw,
      allowP2pOut: dto.allowP2pOut,
      allowP2pIn: dto.allowP2pIn,
    });
    return this.walletTypesRepository.save(type);
  }

  async update(id: string, dto: UpdateWalletTypeDto): Promise<WalletType> {
    const type = await this.findById(id);

    const allowNegativeBalance =
      dto.allowNegativeBalance ?? type.allowNegativeBalance;
    if (
      allowNegativeBalance &&
      dto.creditLimit === undefined &&
      !type.creditLimit
    ) {
      throw new BadRequestException(
        'creditLimit is required when allowNegativeBalance is true',
      );
    }

    if (dto.name !== undefined) type.name = dto.name;
    if (dto.allowWithdraw !== undefined) type.allowWithdraw = dto.allowWithdraw;
    if (dto.allowP2pOut !== undefined) type.allowP2pOut = dto.allowP2pOut;
    if (dto.allowP2pIn !== undefined) type.allowP2pIn = dto.allowP2pIn;
    type.allowNegativeBalance = allowNegativeBalance;
    if (!allowNegativeBalance) {
      type.creditLimit = null;
    } else if (dto.creditLimit !== undefined) {
      type.creditLimit = String(dto.creditLimit);
    }

    return this.walletTypesRepository.save(type);
  }
}
