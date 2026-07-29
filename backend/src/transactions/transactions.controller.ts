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
import { InitiatePurchaseDto } from './dto/initiate-purchase.dto';
import { ReverseTransactionDto } from './dto/reverse-transaction.dto';

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

  @Post('purchase/initiate')
  initiatePurchase(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InitiatePurchaseDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.transactionsService.initiatePurchase(
      user.userId,
      dto.fromWalletId,
      dto.toEmail,
      dto.amount,
      idempotencyKey,
    );
  }

  @Post('purchase/:id/verify')
  verifyPurchase(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.transactionsService.verifyPurchase(user.userId, id);
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

  @Post(':id/reverse')
  reverse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReverseTransactionDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.transactionsService.reverseTransaction(
      user.userId,
      id,
      dto.reason,
      idempotencyKey,
    );
  }
}
