import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { SetPhoneNumberDto } from './dto/set-phone-number.dto';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    const found = await this.usersService.findById(user.userId);
    if (!found) {
      throw new NotFoundException('User not found');
    }
    return {
      id: found.id,
      email: found.email,
      role: found.role,
      phoneNumber: found.phoneNumber,
    };
  }

  @Patch('me/phone-number')
  async setPhoneNumber(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetPhoneNumberDto,
  ) {
    const updated = await this.usersService.setPhoneNumber(
      user.userId,
      dto.phoneNumber,
    );
    return { id: updated.id, phoneNumber: updated.phoneNumber };
  }
}
