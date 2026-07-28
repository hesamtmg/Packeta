import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { WalletTypesService } from './wallet-types.service';
import { CreateWalletTypeDto } from './dto/create-wallet-type.dto';
import { UpdateWalletTypeDto } from './dto/update-wallet-type.dto';

@Controller('wallet-types')
@UseGuards(JwtAuthGuard)
export class WalletTypesController {
  constructor(private readonly walletTypesService: WalletTypesService) {}

  @Get()
  findAll() {
    return this.walletTypesService.findAll();
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@Body() dto: CreateWalletTypeDto) {
    return this.walletTypesService.create(dto);
  }

  @Patch(':id')
  @UseGuards(AdminGuard)
  update(@Param('id') id: string, @Body() dto: UpdateWalletTypeDto) {
    return this.walletTypesService.update(id, dto);
  }
}
