import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Ip,
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
import { Public } from '../common/decorators/public.decorator';
import { TransactionsService } from './transactions.service';
import { DepositDto } from './dto/deposit.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { TransferDto } from './dto/transfer.dto';
import { InitiatePurchaseDto } from './dto/initiate-purchase.dto';
import { InitiateChargeDto } from './dto/initiate-charge.dto';
import { ReverseTransactionDto } from './dto/reverse-transaction.dto';
import { CustomerActionGuard } from '../admin/guards/customer-action.guard';
import { RequireCustomerAction } from '../admin/decorators/require-customer-action.decorator';

const HISTORY_DEFAULT_LIMIT = 25;
const HISTORY_MAX_LIMIT = 100;

function parseIntParam(
  name: string,
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new BadRequestException(`${name} must be a non-negative integer`);
  }
  const value = Number(raw);
  if (value < min || value > max) {
    throw new BadRequestException(`${name} must be between ${min} and ${max}`);
  }
  return value;
}

function parseSince(raw: string | undefined): Date | undefined {
  if (raw === undefined || raw === '') return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('since must be an ISO date');
  }
  return date;
}

@Controller('transactions')
@UseGuards(JwtAuthGuard, CustomerActionGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post('deposit')
  @RequireCustomerAction('deposit')
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
  @RequireCustomerAction('withdraw')
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: WithdrawDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.transactionsService.withdraw(
      user.userId,
      dto.walletId,
      dto.amount,
      dto.railType,
      dto.destinationIban,
      idempotencyKey,
    );
  }

  @Post('transfer')
  @RequireCustomerAction('transfer')
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
  @RequireCustomerAction('purchaseAction')
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

  @Post('installments/:id/pay')
  payInstallment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.transactionsService.payInstallment(
      user.userId,
      id,
      idempotencyKey,
    );
  }

  @Post('purchase/charge')
  initiateCharge(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InitiateChargeDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Ip() ip: string,
    @Headers('origin') origin?: string,
    @Headers('referer') referer?: string,
  ) {
    return this.transactionsService.initiateCharge(
      user.userId,
      dto.amount,
      dto.currencyCode,
      idempotencyKey,
      dto.language,
      dto.settlementSplits,
      undefined,
      { ip, origin: origin ?? referer },
    );
  }

  // Public: the customer landing on the callback page may have no Packeta
  // session at all (charge-based purchases identify them by phone+OTP at
  // the IPG instead) — see verifyPurchase's own comment for why that's safe.
  @Public()
  @Post('purchase/:id/verify')
  verifyPurchase(@Param('id') id: string) {
    return this.transactionsService.verifyPurchase(id);
  }

  // Public, same reasoning — and scoped server-side to PENDING purchases
  // only, so it can never be used to undo a completed one.
  @Public()
  @Post('purchase/:id/cancel')
  cancelPendingPurchase(@Param('id') id: string) {
    return this.transactionsService.cancelPendingPurchase(id);
  }

  // Without limit/offset this returns the full history as a plain array, as
  // it always has (third-party integrations rely on that shape). Passing
  // either switches to a paged envelope: { items, total, limit, offset }.
  // `since` (ISO date) narrows either form to rows created at or after it.
  @Get()
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Query('walletId') walletId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('since') since?: string,
  ) {
    const sinceDate = parseSince(since);
    if (limit === undefined && offset === undefined) {
      return this.transactionsService.getHistory(user.userId, walletId, {
        since: sinceDate,
      });
    }
    return this.transactionsService.getHistoryPage(user.userId, walletId, {
      limit: parseIntParam(
        'limit',
        limit,
        HISTORY_DEFAULT_LIMIT,
        1,
        HISTORY_MAX_LIMIT,
      ),
      offset: parseIntParam('offset', offset, 0, 0, Number.MAX_SAFE_INTEGER),
      since: sinceDate,
    });
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
