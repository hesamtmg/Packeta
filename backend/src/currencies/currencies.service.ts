import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Currency } from './entities/currency.entity';

@Injectable()
export class CurrenciesService {
  constructor(
    @InjectRepository(Currency)
    private readonly currenciesRepository: Repository<Currency>,
  ) {}

  findAll(): Promise<Currency[]> {
    return this.currenciesRepository.find({ order: { code: 'ASC' } });
  }

  async findByCode(code: string): Promise<Currency> {
    const currency = await this.currenciesRepository.findOne({
      where: { code },
    });
    if (!currency) {
      throw new NotFoundException(`Unknown currency "${code}"`);
    }
    return currency;
  }
}
