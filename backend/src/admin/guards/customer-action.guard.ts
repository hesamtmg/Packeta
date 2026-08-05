import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsersService } from '../../users/users.service';
import { REQUIRE_CUSTOMER_ACTION_KEY } from '../decorators/require-customer-action.decorator';
import type { CustomerAction } from '../admin-sections';

// Gates a customer-facing action (add wallet / deposit / withdraw /
// transfer / purchase) behind the acting user's Panel Role, if one is
// assigned. Mirrors SectionGuard's shape but the default flips: a customer
// with no panelRoleId keeps full access (matches behavior before this
// permission system existed), while a customer WITH a role must have the
// matching action explicitly granted. Re-fetches from the DB every request
// so a permission change takes effect immediately.
@Injectable()
export class CustomerActionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<CustomerAction>(
      REQUIRE_CUSTOMER_ACTION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = await this.usersService.findById(request.user.userId);
    if (!user) {
      throw new ForbiddenException('Account not found');
    }
    if (!user.panelRoleId) {
      return true;
    }
    const granted = user.panelRole?.permissions ?? [];
    if (granted.includes(required)) {
      return true;
    }
    throw new ForbiddenException(
      'You do not have permission to perform this action',
    );
  }
}
