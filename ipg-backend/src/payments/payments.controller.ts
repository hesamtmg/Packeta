import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { ApiKeyGuard } from '../common/guards/api-key.guard';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @UseGuards(ApiKeyGuard)
  create(@Body() dto: CreatePaymentDto) {
    return this.paymentsService.create(dto);
  }

  @Get(':authority')
  getPublic(@Param('authority') authority: string) {
    return this.paymentsService.getPublic(authority);
  }

  @Post(':authority/confirm')
  confirm(@Param('authority') authority: string) {
    return this.paymentsService.confirm(authority);
  }

  @Post(':authority/cancel')
  cancel(@Param('authority') authority: string) {
    return this.paymentsService.cancel(authority);
  }

  @Post(':authority/verify')
  @UseGuards(ApiKeyGuard)
  verify(@Param('authority') authority: string, @Body() dto: VerifyPaymentDto) {
    return this.paymentsService.verify(authority, dto.amount);
  }
}
