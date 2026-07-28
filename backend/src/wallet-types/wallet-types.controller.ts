import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletTypesService } from './wallet-types.service';

@Controller('wallet-types')
@UseGuards(JwtAuthGuard)
export class WalletTypesController {
  constructor(private readonly walletTypesService: WalletTypesService) {}

  @Get()
  findAll() {
    return this.walletTypesService.findAll();
  }
}
