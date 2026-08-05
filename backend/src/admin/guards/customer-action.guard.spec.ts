import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CustomerActionGuard } from './customer-action.guard';

function buildContext(userId: string, requiredAction: string | undefined) {
  const reflector = {
    getAllAndOverride: jest.fn(() => requiredAction),
  } as unknown as Reflector;
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: { userId } }),
    }),
  } as unknown as ExecutionContext;
  return { reflector, context };
}

describe('CustomerActionGuard', () => {
  it('allows the request through when the route has no @RequireCustomerAction metadata', async () => {
    const { reflector, context } = buildContext('u1', undefined);
    const usersService = { findById: jest.fn() };
    const guard = new CustomerActionGuard(reflector, usersService as any);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(usersService.findById).not.toHaveBeenCalled();
  });

  it('allows a customer with no panel role assigned (backward-compatible default)', async () => {
    const { reflector, context } = buildContext('u1', 'deposit');
    const usersService = {
      findById: jest.fn(async () => ({ panelRoleId: null, panelRole: null })),
    };
    const guard = new CustomerActionGuard(reflector, usersService as any);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('allows a customer whose panel role grants the required action', async () => {
    const { reflector, context } = buildContext('u1', 'deposit');
    const usersService = {
      findById: jest.fn(async () => ({
        panelRoleId: 'r1',
        panelRole: { permissions: ['deposit', 'withdraw'] },
      })),
    };
    const guard = new CustomerActionGuard(reflector, usersService as any);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects a customer whose panel role does not grant the required action', async () => {
    const { reflector, context } = buildContext('u1', 'deposit');
    const usersService = {
      findById: jest.fn(async () => ({
        panelRoleId: 'r1',
        panelRole: { permissions: ['withdraw'] },
      })),
    };
    const guard = new CustomerActionGuard(reflector, usersService as any);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
