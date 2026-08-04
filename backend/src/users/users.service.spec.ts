import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { User, UserRole } from './entities/user.entity';
import { ADMIN_SECTIONS } from '../admin/admin-sections';

function buildService(user: Partial<User>) {
  const record = { ...user } as User;
  const usersRepository = {
    findOne: jest.fn(async () => record),
    save: jest.fn(async (u: User) => {
      Object.assign(record, u);
      return record;
    }),
  };
  const service = new UsersService(usersRepository as any);
  return { service, usersRepository, record };
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
    const service = new UsersService(usersRepository as any);

    await expect(
      service.updateProfile('missing', { name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws ConflictException when the national code is already taken', async () => {
    const usersRepository = {
      findOne: jest.fn(async () => ({ id: 'u1' }) as User),
      save: jest.fn(async () => {
        throw { code: '23505' };
      }),
    };
    const service = new UsersService(usersRepository as any);

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
    const service = new UsersService(usersRepository as any);

    await expect(
      service.setAvatar('missing', 'new.png'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UsersService.setRole', () => {
  it('grants every panel section when freshly promoting a USER to ADMIN', async () => {
    const { service, record } = buildService({
      id: 'u1',
      role: UserRole.USER,
      permissions: null,
    });

    await service.setRole('u1', UserRole.ADMIN);

    expect(record.role).toBe(UserRole.ADMIN);
    expect(record.permissions).toEqual([...ADMIN_SECTIONS]);
  });

  it('does not overwrite an existing ADMIN permissions list on a no-op role set', async () => {
    const { service, record } = buildService({
      id: 'u1',
      role: UserRole.ADMIN,
      permissions: ['wallets'],
    });

    await service.setRole('u1', UserRole.ADMIN);

    expect(record.permissions).toEqual(['wallets']);
  });

  it('leaves permissions untouched when demoting to USER', async () => {
    const { service, record } = buildService({
      id: 'u1',
      role: UserRole.ADMIN,
      permissions: ['wallets'],
    });

    await service.setRole('u1', UserRole.USER);

    expect(record.role).toBe(UserRole.USER);
    expect(record.permissions).toEqual(['wallets']);
  });
});

describe('UsersService.setPermissions', () => {
  it('replaces the permissions list for a regular ADMIN', async () => {
    const { service, record } = buildService({
      id: 'u1',
      role: UserRole.ADMIN,
      permissions: ['wallets'],
    });

    await service.setPermissions('u1', ['customers', 'reports']);

    expect(record.permissions).toEqual(['customers', 'reports']);
  });

  it('rejects narrowing permissions on a SUPER_ADMIN account', async () => {
    const { service } = buildService({
      id: 'u1',
      role: UserRole.SUPER_ADMIN,
      permissions: null,
    });

    await expect(
      service.setPermissions('u1', ['wallets']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws NotFoundException when the user does not exist', async () => {
    const usersRepository = {
      findOne: jest.fn(async () => null),
      save: jest.fn(),
    };
    const service = new UsersService(usersRepository as any);

    await expect(
      service.setPermissions('missing', ['wallets']),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
