import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PanelRolesService } from './panel-roles.service';
import { PanelRole } from './entities/panel-role.entity';
import { FULL_ACCESS_ROLE_ID } from '../admin/admin-sections';

function buildService(roles: PanelRole[] = []) {
  const store = [...roles];
  const panelRolesRepository = {
    find: jest.fn(async () =>
      [...store].sort((a, b) => a.name.localeCompare(b.name)),
    ),
    findOne: jest.fn(async ({ where }: { where: Partial<PanelRole> }) => {
      const match = store.find((r) =>
        Object.entries(where).every(
          ([key, value]) => (r as any)[key] === value,
        ),
      );
      // Clone, like a real repository fetch — mutating the returned entity
      // must not silently mutate the store until save() is called.
      return match ? { ...match } : null;
    }),
    create: jest.fn(
      (dto: Partial<PanelRole>) => ({ id: 'new-id', ...dto }) as PanelRole,
    ),
    save: jest.fn(async (role: PanelRole) => {
      if (store.some((r) => r.name === role.name && r.id !== role.id)) {
        throw { code: '23505' };
      }
      const existingIndex = store.findIndex((r) => r.id === role.id);
      if (existingIndex >= 0) store[existingIndex] = role;
      else store.push(role);
      return role;
    }),
    update: jest.fn(
      async (criteria: Partial<PanelRole>, partial: Partial<PanelRole>) => {
        for (const role of store) {
          const matches = Object.entries(criteria).every(
            ([key, value]) => (role as any)[key] === value,
          );
          if (matches) Object.assign(role, partial);
        }
      },
    ),
    delete: jest.fn(async (id: string) => {
      const index = store.findIndex((r) => r.id === id);
      if (index >= 0) store.splice(index, 1);
    }),
  };
  const service = new PanelRolesService(panelRolesRepository as any);
  return { service, panelRolesRepository, store };
}

describe('PanelRolesService.create', () => {
  it('creates a new role', async () => {
    const { service } = buildService();

    const role = await service.create({
      name: 'Support Agent',
      permissions: ['wallets', 'customers'],
    });

    expect(role.name).toBe('Support Agent');
    expect(role.permissions).toEqual(['wallets', 'customers']);
  });

  it('rejects a duplicate name with ConflictException', async () => {
    const existing = {
      id: 'r1',
      name: 'Support Agent',
      permissions: [],
    } as unknown as PanelRole;
    const { service } = buildService([existing]);

    await expect(
      service.create({ name: 'Support Agent', permissions: ['wallets'] }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('PanelRolesService.update', () => {
  it('updates the name and permissions of an existing role', async () => {
    const existing = {
      id: 'r1',
      name: 'Old',
      permissions: ['wallets'],
    } as unknown as PanelRole;
    const { service, store } = buildService([existing]);

    const updated = await service.update('r1', {
      name: 'New',
      permissions: ['reports'],
    });

    expect(updated.name).toBe('New');
    expect(updated.permissions).toEqual(['reports']);
    expect(store[0].name).toBe('New');
  });

  it('throws NotFoundException for a missing role', async () => {
    const { service } = buildService();

    await expect(
      service.update('missing', { name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PanelRolesService default-for-signup enforcement', () => {
  it('clears isDefaultForSignup on other roles when a new role is created as default', async () => {
    const existingDefault = {
      id: 'r1',
      name: 'Old Default',
      permissions: [],
      isDefaultForSignup: true,
    } as unknown as PanelRole;
    const { service, store } = buildService([existingDefault]);

    const created = await service.create({
      name: 'New Default',
      permissions: [],
      isDefaultForSignup: true,
    });

    expect(created.isDefaultForSignup).toBe(true);
    expect(store.find((r) => r.id === 'r1')!.isDefaultForSignup).toBe(false);
  });

  it('clears isDefaultForSignup on other roles when an existing role is updated to be default', async () => {
    const existingDefault = {
      id: 'r1',
      name: 'Old Default',
      permissions: [],
      isDefaultForSignup: true,
    } as unknown as PanelRole;
    const other = {
      id: 'r2',
      name: 'Other',
      permissions: [],
      isDefaultForSignup: false,
    } as unknown as PanelRole;
    const { service, store } = buildService([existingDefault, other]);

    const updated = await service.update('r2', { isDefaultForSignup: true });

    expect(updated.isDefaultForSignup).toBe(true);
    expect(store.find((r) => r.id === 'r1')!.isDefaultForSignup).toBe(false);
  });

  it('findDefaultForSignup returns the role marked default, or null', async () => {
    const { service: emptyService } = buildService();
    await expect(emptyService.findDefaultForSignup()).resolves.toBeNull();

    const existingDefault = {
      id: 'r1',
      name: 'Default Role',
      permissions: [],
      isDefaultForSignup: true,
    } as unknown as PanelRole;
    const { service } = buildService([existingDefault]);

    const found = await service.findDefaultForSignup();
    expect(found?.id).toBe('r1');
  });
});

describe('PanelRolesService.delete', () => {
  it('deletes a non-default role', async () => {
    const existing = {
      id: 'r1',
      name: 'Support Agent',
      permissions: [],
    } as unknown as PanelRole;
    const { service, store } = buildService([existing]);

    await service.delete('r1');

    expect(store).toHaveLength(0);
  });

  it('refuses to delete the seeded Full Access role', async () => {
    const fullAccess = {
      id: FULL_ACCESS_ROLE_ID,
      name: 'Full Access',
      permissions: [],
    } as unknown as PanelRole;
    const { service } = buildService([fullAccess]);

    await expect(service.delete(FULL_ACCESS_ROLE_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws NotFoundException for a missing role', async () => {
    const { service } = buildService();

    await expect(service.delete('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
