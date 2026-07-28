import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { TransactionsService } from './transactions.service';
import { DepositDto } from './dto/deposit.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { TransferDto } from './dto/transfer.dto';

@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post('deposit')
  deposit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: DepositDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.transactionsService.deposit(
      user.userId,
      dto.walletId,
      dto.amount,
      idempotencyKey,
    );
  }

  @Post('withdraw')
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: WithdrawDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.transactionsService.withdraw(
      user.userId,
      dto.walletId,
      dto.amount,
      idempotencyKey,
    );
  }

  @Post('transfer')
  transfer(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TransferDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.transactionsService.transfer(
      user.userId,
      dto.fromWalletId,
      dto.toEmail,
      dto.amount,
      idempotencyKey,
    );
  }

  @Get()
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Query('walletId') walletId?: string,
  ) {
    return this.transactionsService.getHistory(user.userId, walletId);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.transactionsService.getById(user.userId, id);
  }
}
