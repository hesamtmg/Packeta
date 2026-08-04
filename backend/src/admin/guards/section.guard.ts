import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsersService } from '../../users/users.service';
import { UserRole } from '../../users/entities/user.entity';
import { REQUIRE_SECTION_KEY } from '../decorators/require-section.decorator';
import type { AdminSection } from '../admin-sections';

// Must run after JwtAuthGuard + AdminGuard. A route with no @RequireSection
// decorator is left untouched (no section metadata = pass through). Where a
// route IS decorated, SUPER_ADMIN always bypasses (see the role-tier
// comment on UserRole) and a regular ADMIN needs at least one of the listed
// sections in their granted permissions. Re-fetches from the DB every
// request — same reasoning as AdminGuard/SuperAdminGuard — so a permission
// change takes effect immediately, not on next login.
@Injectable()
export class SectionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<AdminSection[]>(
      REQUIRE_SECTION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = await this.usersService.findById(request.user.userId);
    if (!user) {
      throw new ForbiddenException('Admin access required');
    }
    if (user.role === UserRole.SUPER_ADMIN) {
      return true;
    }
    const granted = user.panelRole?.permissions ?? [];
    if (required.some((section) => granted.includes(section))) {
      return true;
    }
    throw new ForbiddenException(
      'You do not have permission to access this panel section',
    );
  }
}
