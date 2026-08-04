import { ConflictException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';

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
