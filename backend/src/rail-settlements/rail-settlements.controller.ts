import {
  Controller,
  Get,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { RailSettlementsService } from './rail-settlements.service';
import { serializeRailSettlement } from './rail-settlement.serializer';

@Controller('rail-settlements')
@UseGuards(JwtAuthGuard)
export class RailSettlementsController {
  constructor(
    private readonly railSettlementsService: RailSettlementsService,
  ) {}

  @Get()
  async listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query('walletId', new ParseUUIDPipe({ optional: true })) walletId?: string,
  ) {
    // Optional walletId narrows to one of the caller's own wallets (used by
    // the merchant settlement card on the wallet page) — still scoped to the
    // caller, so another user's wallet id just yields an empty list.
    const settlements = await this.railSettlementsService.findAllForUser(
      user.userId,
      walletId,
    );
    return settlements.map(serializeRailSettlement);
  }
}
