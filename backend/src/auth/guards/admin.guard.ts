import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UsersService } from '../../users/users.service';
import { UserRole } from '../../users/entities/user.entity';

// Must run after JwtAuthGuard (req.user populated). Re-fetches the user's
// current role from the DB on every request rather than trusting a role
// claim baked into the JWT, so revoking admin access takes effect
// immediately instead of waiting for the token to expire.
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly usersService: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = await this.usersService.findById(request.user.userId);
    const isAdmin =
      user?.role === UserRole.ADMIN || user?.role === UserRole.SUPER_ADMIN;
    if (!isAdmin) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
