import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { User, UserRole } from './entities/user.entity';
import { PanelRole } from '../panel-roles/entities/panel-role.entity';
import { ADMIN_SECTIONS, FULL_ACCESS_ROLE_ID } from '../admin/admin-sections';

// Simulates the User entity's eager-loaded `panelRole` relation: findOne()
// always resolves it fresh from the current panelRoleId + the roles table,
// same as TypeORM would after a raw `.update()` on the FK column.
function buildService(user: Partial<User>, roles: PanelRole[] = []) {
  const record = { ...user } as User;
  const rolesById = new Map(roles.map((r) => [r.id, r]));
  const usersRepository = {
    findOne: jest.fn(async () => ({
      ...record,
      panelRole: record.panelRoleId
        ? (rolesById.get(record.panelRoleId) ?? null)
        : null,
    })),
    update: jest.fn(async (_id: string, patch: Partial<User>) => {
      Object.assign(record, patch);
    }),
    save: jest.fn(async (u: User) => {
      Object.assign(record, u);
      return record;
    }),
  };
  const panelRolesRepository = {
    findOne: jest.fn(
      async ({ where: { id } }: { where: { id: string } }) =>
        rolesById.get(id) ?? null,
    ),
  };
  const service = new UsersService(
    usersRepository as any,
    panelRolesRepository as any,
  );
  return { service, usersRepository, panelRolesRepository, record };
}

describe('UsersService.updateProfile', () => {
  it('sets name and nationalCode when both are provided', async () => {
    const { service, record } = buildService({
      id: 'u1',
      name: null,
      nationalCode: null,
    });

    await service.updateProfile('u1', {
      name: 'Ada Lovelace',
      nationalCode: '1234567890',
    });

    expect(record.name).toBe('Ada Lovelace');
    expect(record.nationalCode).toBe('1234567890');
  });

  it('trims the name and clears it when trimming leaves nothing', async () => {
    const { service, record } = buildService({ id: 'u1', name: 'Old Name' });

    await service.updateProfile('u1', { name: '   ' });

    expect(record.name).toBeNull();
  });

  it('clears nationalCode when given an empty string', async () => {
    const { service, record } = buildService({
      id: 'u1',
      nationalCode: '1234567890',
    });

    await service.updateProfile('u1', { nationalCode: '' });

    expect(record.nationalCode).toBeNull();
  });

  it('leaves fields untouched when they are not provided', async () => {
    const { service, record } = buildService({
      id: 'u1',
      name: 'Ada Lovelace',
      nationalCode: '1234567890',
    });

    await service.updateProfile('u1', {});

    expect(record.name).toBe('Ada Lovelace');
    expect(record.nationalCode).toBe('1234567890');
  });

  it('throws NotFoundException when the user does not exist', async () => {
    const usersRepository = {
      findOne: jest.fn(async () => null),
      save: jest.fn(),
    };
    const panelRolesRepository = { findOne: jest.fn() };
    const service = new UsersService(
      usersRepository as any,
      panelRolesRepository as any,
    );

    await expect(
      service.updateProfile('missing', { name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws ConflictException when the national code is already taken', async () => {
    const { service, usersRepository } = buildService({ id: 'u1' });
    usersRepository.save.mockImplementationOnce(async () => {
      throw { code: '23505' };
    });

    await expect(
      service.updateProfile('u1', { nationalCode: '1234567890' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('UsersService.setAvatar', () => {
  it('replaces the avatar filename and returns the previous one', async () => {
    const { service, record } = buildService({
      id: 'u1',
      avatarFilename: 'old.png',
    });

    const result = await service.setAvatar('u1', 'new.png');

    expect(record.avatarFilename).toBe('new.png');
    expect(result.previousFilename).toBe('old.png');
    expect(result.user.avatarFilename).toBe('new.png');
  });

  it('returns null as the previous filename when none was set', async () => {
    const { service } = buildService({ id: 'u1', avatarFilename: null });

    const result = await service.setAvatar('u1', 'new.png');

    expect(result.previousFilename).toBeNull();
  });

  it('throws NotFoundException when the user does not exist', async () => {
    const usersRepository = {
      findOne: jest.fn(async () => null),
      save: jest.fn(),
    };
    const panelRolesRepository = { findOne: jest.fn() };
    const service = new UsersService(
      usersRepository as any,
      panelRolesRepository as any,
    );

    await expect(
      service.setAvatar('missing', 'new.png'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UsersService.setRole', () => {
  const fullAccessRole = {
    id: FULL_ACCESS_ROLE_ID,
    name: 'Full Access',
    permissions: [...ADMIN_SECTIONS],
  } as PanelRole;

  it('auto-assigns the Full Access role when freshly promoting a USER to ADMIN', async () => {
    const { service, record } = buildService(
      { id: 'u1', role: UserRole.USER, panelRoleId: null },
      [fullAccessRole],
    );

    await service.setRole('u1', UserRole.ADMIN);

    expect(record.role).toBe(UserRole.ADMIN);
    expect(record.panelRoleId).toBe(FULL_ACCESS_ROLE_ID);
  });

  it('leaves panelRoleId null when promoting and the Full Access role no longer exists', async () => {
    const { service, record } = buildService(
      { id: 'u1', role: UserRole.USER, panelRoleId: null },
      [],
    );

    await service.setRole('u1', UserRole.ADMIN);

    expect(record.role).toBe(UserRole.ADMIN);
    expect(record.panelRoleId).toBeNull();
  });

  it('does not overwrite an already-assigned role on a no-op role set', async () => {
    const customRole = {
      id: 'r2',
      name: 'Support',
      permissions: ['wallets'],
    } as PanelRole;
    const { service, record } = buildService(
      { id: 'u1', role: UserRole.ADMIN, panelRoleId: 'r2' },
      [fullAccessRole, customRole],
    );

    await service.setRole('u1', UserRole.ADMIN);

    expect(record.panelRoleId).toBe('r2');
  });

  it('leaves the assigned role untouched when demoting to USER', async () => {
    const customRole = {
      id: 'r2',
      name: 'Support',
      permissions: ['wallets'],
    } as PanelRole;
    const { service, record } = buildService(
      { id: 'u1', role: UserRole.ADMIN, panelRoleId: 'r2' },
      [customRole],
    );

    await service.setRole('u1', UserRole.USER);

    expect(record.role).toBe(UserRole.USER);
    expect(record.panelRoleId).toBe('r2');
  });
});

describe('UsersService.setPanelRole', () => {
  it('assigns an existing role to a regular ADMIN', async () => {
    const role = {
      id: 'r1',
      name: 'Support',
      permissions: ['wallets', 'customers'],
    } as PanelRole;
    const { service, record } = buildService(
      { id: 'u1', role: UserRole.ADMIN, panelRoleId: null },
      [role],
    );

    await service.setPanelRole('u1', 'r1');

    expect(record.panelRoleId).toBe('r1');
  });

  it('clears the role when passed null', async () => {
    const role = {
      id: 'r1',
      name: 'Support',
      permissions: ['wallets'],
    } as PanelRole;
    const { service, record } = buildService(
      { id: 'u1', role: UserRole.ADMIN, panelRoleId: 'r1' },
      [role],
    );

    await service.setPanelRole('u1', null);

    expect(record.panelRoleId).toBeNull();
  });

  it('rejects assigning a role to a SUPER_ADMIN account', async () => {
    const { service } = buildService({
      id: 'u1',
      role: UserRole.SUPER_ADMIN,
      panelRoleId: null,
    });

    await expect(service.setPanelRole('u1', null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws NotFoundException when the role does not exist', async () => {
    const { service } = buildService(
      { id: 'u1', role: UserRole.ADMIN, panelRoleId: null },
      [],
    );

    await expect(
      service.setPanelRole('u1', 'missing-role'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException when the user does not exist', async () => {
    const usersRepository = {
      findOne: jest.fn(async () => null),
      save: jest.fn(),
    };
    const panelRolesRepository = { findOne: jest.fn() };
    const service = new UsersService(
      usersRepository as any,
      panelRolesRepository as any,
    );

    await expect(service.setPanelRole('missing', null)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
