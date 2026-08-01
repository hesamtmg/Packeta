import { Controller, Get, UseGuards } from '@nestjs/common';
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
  async listMine(@CurrentUser() user: AuthenticatedUser) {
    const settlements = await this.railSettlementsService.findAllForUser(
      user.userId,
    );
    return settlements.map(serializeRailSettlement);
  }
}
