import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { WalletTypesService } from './wallet-types.service';
import { CreateWalletTypeDto } from './dto/create-wallet-type.dto';
import { UpdateWalletTypeDto } from './dto/update-wallet-type.dto';

// Wallet types are the "laws" every wallet is bound by, so managing them
// (create/edit/delete) is super-admin-only — a regular admin can still read
// them (findAll, used when creating a wallet) but not change the rules.
@Controller('wallet-types')
@UseGuards(JwtAuthGuard)
export class WalletTypesController {
  constructor(private readonly walletTypesService: WalletTypesService) {}

  @Get()
  findAll() {
    return this.walletTypesService.findAll();
  }

  @Post()
  @UseGuards(SuperAdminGuard)
  create(@Body() dto: CreateWalletTypeDto) {
    return this.walletTypesService.create(dto);
  }

  @Patch(':id')
  @UseGuards(SuperAdminGuard)
  update(@Param('id') id: string, @Body() dto: UpdateWalletTypeDto) {
    return this.walletTypesService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(SuperAdminGuard)
  async remove(@Param('id') id: string) {
    await this.walletTypesService.delete(id);
    return { deleted: true };
  }
}
