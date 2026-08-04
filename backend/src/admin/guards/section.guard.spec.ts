import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SectionGuard } from './section.guard';
import { UserRole } from '../../users/entities/user.entity';

function buildContext(userId: string, requiredSections: string[] | undefined) {
  const reflector = {
    getAllAndOverride: jest.fn(() => requiredSections),
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

describe('SectionGuard', () => {
  it('allows the request through when the route has no @RequireSection metadata', async () => {
    const { reflector, context } = buildContext('u1', undefined);
    const usersService = { findById: jest.fn() };
    const guard = new SectionGuard(reflector, usersService as any);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(usersService.findById).not.toHaveBeenCalled();
  });

  it('always allows a SUPER_ADMIN, regardless of their permissions list', async () => {
    const { reflector, context } = buildContext('u1', ['wallets']);
    const usersService = {
      findById: jest.fn(async () => ({
        role: UserRole.SUPER_ADMIN,
        permissions: null,
      })),
    };
    const guard = new SectionGuard(reflector, usersService as any);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('allows a regular ADMIN who has at least one of the required sections', async () => {
    const { reflector, context } = buildContext('u1', ['wallets', 'reports']);
    const usersService = {
      findById: jest.fn(async () => ({
        role: UserRole.ADMIN,
        permissions: ['reports'],
      })),
    };
    const guard = new SectionGuard(reflector, usersService as any);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects a regular ADMIN who has none of the required sections', async () => {
    const { reflector, context } = buildContext('u1', ['wallets']);
    const usersService = {
      findById: jest.fn(async () => ({
        role: UserRole.ADMIN,
        permissions: ['customers'],
      })),
    };
    const guard = new SectionGuard(reflector, usersService as any);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects a regular ADMIN with no permissions at all', async () => {
    const { reflector, context } = buildContext('u1', ['wallets']);
    const usersService = {
      findById: jest.fn(async () => ({
        role: UserRole.ADMIN,
        permissions: null,
      })),
    };
    const guard = new SectionGuard(reflector, usersService as any);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
