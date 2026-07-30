import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UsersService } from '../../users/users.service';
import { UserRole } from '../../users/entities/user.entity';

// Must run after JwtAuthGuard, and typically alongside/after AdminGuard.
// Gates the two things a regular admin can't do: promote/demote other
// admins, and manage wallet types. Re-fetches from the DB every request,
// same reasoning as AdminGuard — a demotion takes effect immediately.
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly usersService: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = await this.usersService.findById(request.user.userId);
    if (!user || user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super admin access required');
    }
    return true;
  }
}
