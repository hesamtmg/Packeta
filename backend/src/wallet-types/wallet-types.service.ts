import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WalletType } from './entities/wallet-type.entity';
import { Wallet } from '../wallets/entities/wallet.entity';
import { CurrenciesService } from '../currencies/currencies.service';
import { CreateWalletTypeDto } from './dto/create-wallet-type.dto';
import { UpdateWalletTypeDto } from './dto/update-wallet-type.dto';

@Injectable()
export class WalletTypesService {
  constructor(
    @InjectRepository(WalletType)
    private readonly walletTypesRepository: Repository<WalletType>,
    @InjectRepository(Wallet)
    private readonly walletsRepository: Repository<Wallet>,
    private readonly currenciesService: CurrenciesService,
  ) {}

  findAll(): Promise<WalletType[]> {
    return this.walletTypesRepository.find({
      relations: { currency: true },
      order: { name: 'ASC' },
    });
  }

  async findById(id: string): Promise<WalletType> {
    const type = await this.walletTypesRepository.findOne({
      where: { id },
      relations: { currency: true },
    });
    if (!type) {
      throw new NotFoundException('Wallet type not found');
    }
    return type;
  }

  async create(dto: CreateWalletTypeDto): Promise<WalletType> {
    const currency = await this.currenciesService.findByCode(dto.currencyCode);

    const existing = await this.walletTypesRepository.findOne({
      where: { code: dto.code, currencyId: currency.id },
    });
    if (existing) {
      throw new ConflictException(
        `Wallet type "${dto.code}" already exists for ${currency.code}`,
      );
    }
    if (dto.allowNegativeBalance && dto.creditLimit === undefined) {
      throw new BadRequestException(
        'creditLimit is required when allowNegativeBalance is true',
      );
    }
    if (dto.autoWithdrawTimes?.length && dto.autoWithdrawTimes.length !== 3) {
      throw new BadRequestException(
        'autoWithdrawTimes must be exactly 3 times, or omitted/empty to leave the schedule unset',
      );
    }
    if (dto.autoWithdrawTimes?.length && !dto.supportsAutoWithdraw) {
      throw new BadRequestException(
        'supportsAutoWithdraw must be true to set autoWithdrawTimes',
      );
    }

    const type = this.walletTypesRepository.create({
      code: dto.code,
      name: dto.name,
      currencyId: currency.id,
      allowNegativeBalance: dto.allowNegativeBalance,
      creditLimit: dto.allowNegativeBalance ? String(dto.creditLimit) : null,
      allowWithdraw: dto.allowWithdraw,
      allowP2pOut: dto.allowP2pOut,
      allowP2pIn: dto.allowP2pIn,
      supportsAutoWithdraw: dto.supportsAutoWithdraw ?? false,
      autoWithdrawTimes: dto.autoWithdrawTimes?.length
        ? dto.autoWithdrawTimes
        : null,
      allowPurchaseOut: dto.allowPurchaseOut ?? false,
      allowPurchaseIn: dto.allowPurchaseIn ?? false,
      depositable: dto.depositable ?? true,
      installmentDate: dto.installmentDate ?? null,
      paymentDeadlineDate: dto.paymentDeadlineDate ?? null,
      fee: dto.fee !== undefined ? String(dto.fee) : null,
      penalty: dto.penalty !== undefined ? String(dto.penalty) : null,
      unblockFee: dto.unblockFee !== undefined ? String(dto.unblockFee) : null,
      installmentCount: dto.installmentCount ?? null,
    });
    const saved = await this.walletTypesRepository.save(type);
    saved.currency = currency;
    return saved;
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

    const supportsAutoWithdraw =
      dto.supportsAutoWithdraw ?? type.supportsAutoWithdraw;
    if (dto.autoWithdrawTimes !== undefined) {
      if (dto.autoWithdrawTimes.length && dto.autoWithdrawTimes.length !== 3) {
        throw new BadRequestException(
          'autoWithdrawTimes must be exactly 3 times, or an empty array to clear it',
        );
      }
      if (dto.autoWithdrawTimes.length && !supportsAutoWithdraw) {
        throw new BadRequestException(
          'supportsAutoWithdraw must be true to set autoWithdrawTimes',
        );
      }
    } else if (
      !supportsAutoWithdraw &&
      dto.supportsAutoWithdraw !== undefined
    ) {
      // Turning supportsAutoWithdraw off without also clearing the times —
      // clear them too, since a stale schedule on a type that can no longer
      // sweep would otherwise linger invisibly.
      type.autoWithdrawTimes = null;
    }

    if (dto.name !== undefined) type.name = dto.name;
    if (dto.allowWithdraw !== undefined) type.allowWithdraw = dto.allowWithdraw;
    if (dto.allowP2pOut !== undefined) type.allowP2pOut = dto.allowP2pOut;
    if (dto.allowP2pIn !== undefined) type.allowP2pIn = dto.allowP2pIn;
    if (dto.supportsAutoWithdraw !== undefined) {
      type.supportsAutoWithdraw = dto.supportsAutoWithdraw;
    }
    if (dto.autoWithdrawTimes !== undefined) {
      type.autoWithdrawTimes = dto.autoWithdrawTimes.length
        ? dto.autoWithdrawTimes
        : null;
    }
    if (dto.allowPurchaseOut !== undefined) {
      type.allowPurchaseOut = dto.allowPurchaseOut;
    }
    if (dto.allowPurchaseIn !== undefined) {
      type.allowPurchaseIn = dto.allowPurchaseIn;
    }
    if (dto.depositable !== undefined) {
      type.depositable = dto.depositable;
    }
    if (dto.installmentDate !== undefined) {
      type.installmentDate = dto.installmentDate;
    }
    if (dto.paymentDeadlineDate !== undefined) {
      type.paymentDeadlineDate = dto.paymentDeadlineDate;
    }
    if (dto.fee !== undefined) {
      type.fee = String(dto.fee);
    }
    if (dto.penalty !== undefined) {
      type.penalty = String(dto.penalty);
    }
    if (dto.unblockFee !== undefined) {
      type.unblockFee = String(dto.unblockFee);
    }
    if (dto.installmentCount !== undefined) {
      type.installmentCount = dto.installmentCount;
    }
    type.allowNegativeBalance = allowNegativeBalance;
    if (!allowNegativeBalance) {
      type.creditLimit = null;
    } else if (dto.creditLimit !== undefined) {
      type.creditLimit = String(dto.creditLimit);
    }

    return this.walletTypesRepository.save(type);
  }

  // Hard-delete is safe here (unlike a Wallet, a WalletType has no financial
  // history of its own) but only once nothing references it — deleting a
  // type still in use would orphan every wallet of that type.
  async delete(id: string): Promise<void> {
    const type = await this.findById(id);
    const walletCount = await this.walletsRepository.count({
      where: { walletTypeId: type.id },
    });
    if (walletCount > 0) {
      throw new ConflictException(
        `Cannot delete "${type.name}" — ${walletCount} wallet(s) still use this type`,
      );
    }
    await this.walletTypesRepository.delete(type.id);
  }
}
