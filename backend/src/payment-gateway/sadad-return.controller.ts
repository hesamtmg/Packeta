import {
  All,
  Body,
  Controller,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { PaymentGatewayService } from './payment-gateway.service';

// Where Sadad sends the customer's browser back after the bank page — Sadad
// POSTs an application/x-www-form-urlencoded form (token, ResCode, OrderId).
// GET is accepted as well, in case a browser re-requests the URL. No auth:
// the customer has no Packeta session on this hop, and nothing here moves
// money — it only redirects to the signed callback URL, where the frontend
// calls /transactions/purchase/:id/verify, which asks Sadad itself.
@Controller('payment-gateway/sadad')
export class SadadReturnController {
  constructor(private readonly paymentGatewayService: PaymentGatewayService) {}

  @All('return')
  handleReturn(
    @Query('next') next: string | undefined,
    @Query('sig') sig: string | undefined,
    @Query() query: Record<string, string | undefined>,
    @Body() body: Record<string, unknown> | undefined,
    @Res() res: Response,
  ) {
    const field = (...names: string[]): string => {
      for (const name of names) {
        const value = body?.[name] ?? query[name];
        if (value !== undefined && value !== null && value !== '') {
          return String(value).trim();
        }
      }
      return '';
    };
    const token = field('token', 'Token');
    const resCode = field('ResCode', 'rescode', 'resCode');

    const redirectTo = this.paymentGatewayService.resolveSadadReturn(
      next,
      sig,
      token,
      resCode,
    );
    // 303 turns the bank's POST into a GET on the SPA callback route.
    res.redirect(303, redirectTo);
  }
}
