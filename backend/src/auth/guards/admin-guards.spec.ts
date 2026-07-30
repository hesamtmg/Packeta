import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { SuperAdminGuard } from './super-admin.guard';
import { UserRole } from '../../users/entities/user.entity';

function contextWithUser(userId: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { userId } }),
    }),
  } as unknown as ExecutionContext;
}

function usersServiceReturning(role: UserRole | null) {
  return {
    findById: jest.fn(async () => (role ? { id: 'u1', role } : null)),
  };
}

describe('AdminGuard', () => {
  it('allows a regular admin', async () => {
    const guard = new AdminGuard(usersServiceReturning(UserRole.ADMIN) as any);
    await expect(guard.canActivate(contextWithUser('u1'))).resolves.toBe(true);
  });

  it('allows a super admin', async () => {
    const guard = new AdminGuard(
      usersServiceReturning(UserRole.SUPER_ADMIN) as any,
    );
    await expect(guard.canActivate(contextWithUser('u1'))).resolves.toBe(true);
  });

  it('rejects a regular user', async () => {
    const guard = new AdminGuard(usersServiceReturning(UserRole.USER) as any);
    await expect(
      guard.canActivate(contextWithUser('u1')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('SuperAdminGuard', () => {
  it('allows a super admin', async () => {
    const guard = new SuperAdminGuard(
      usersServiceReturning(UserRole.SUPER_ADMIN) as any,
    );
    await expect(guard.canActivate(contextWithUser('u1'))).resolves.toBe(true);
  });

  it('rejects a regular admin', async () => {
    const guard = new SuperAdminGuard(
      usersServiceReturning(UserRole.ADMIN) as any,
    );
    await expect(
      guard.canActivate(contextWithUser('u1')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a regular user', async () => {
    const guard = new SuperAdminGuard(
      usersServiceReturning(UserRole.USER) as any,
    );
    await expect(
      guard.canActivate(contextWithUser('u1')),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
