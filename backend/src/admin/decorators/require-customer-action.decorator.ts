import { SetMetadata } from '@nestjs/common';
import type { CustomerAction } from '../admin-sections';

export const REQUIRE_CUSTOMER_ACTION_KEY = 'requireCustomerAction';

// Marks a customer-facing route as gated by a Panel Role's customer-action
// permissions (see CustomerActionGuard). Single action per route — unlike
// RequireSection there's no any-of case here since each route maps to
// exactly one dashboard card.
export const RequireCustomerAction = (action: CustomerAction) =>
  SetMetadata(REQUIRE_CUSTOMER_ACTION_KEY, action);
