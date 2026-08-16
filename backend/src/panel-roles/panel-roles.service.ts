import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PanelRole } from './entities/panel-role.entity';
import { FULL_ACCESS_ROLE_ID } from '../admin/admin-sections';

@Injectable()
export class PanelRolesService {
  constructor(
    @InjectRepository(PanelRole)
    private readonly panelRolesRepository: Repository<PanelRole>,
  ) {}

  findAll(): Promise<PanelRole[]> {
    return this.panelRolesRepository.find({ order: { name: 'ASC' } });
  }

  async findById(id: string): Promise<PanelRole> {
    const role = await this.panelRolesRepository.findOne({ where: { id } });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    return role;
  }

  // The role auto-assigned as panelRoleId for every new self-service signup
  // (see AuthService.signup/verifyPhoneOtp and BatchImportService). At most
  // one row can have isDefaultForSignup true at a time, so this is either
  // one row or none.
  findDefaultForSignup(): Promise<PanelRole | null> {
    return this.panelRolesRepository.findOne({
      where: { isDefaultForSignup: true },
    });
  }

  async create(dto: {
    name: string;
    permissions: string[];
    isDefaultForSignup?: boolean;
  }): Promise<PanelRole> {
    try {
      if (dto.isDefaultForSignup) {
        await this.panelRolesRepository.update(
          { isDefaultForSignup: true },
          { isDefaultForSignup: false },
        );
      }
      return await this.panelRolesRepository.save(
        this.panelRolesRepository.create(dto),
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('A role with this name already exists');
      }
      throw error;
    }
  }

  async update(
    id: string,
    updates: {
      name?: string;
      permissions?: string[];
      isDefaultForSignup?: boolean;
    },
  ): Promise<PanelRole> {
    const role = await this.findById(id);
    if (updates.name !== undefined) role.name = updates.name;
    if (updates.permissions !== undefined)
      role.permissions = updates.permissions;
    if (updates.isDefaultForSignup !== undefined) {
      role.isDefaultForSignup = updates.isDefaultForSignup;
    }
    try {
      if (role.isDefaultForSignup) {
        await this.panelRolesRepository.update(
          { isDefaultForSignup: true },
          { isDefaultForSignup: false },
        );
      }
      return await this.panelRolesRepository.save(role);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('A role with this name already exists');
      }
      throw error;
    }
  }

  // Any admin currently assigned this role falls back to no panel sections
  // (beyond the always-visible dashboard) — see the FK's ON DELETE SET NULL
  // in the AddPanelRoles migration.
  async delete(id: string): Promise<void> {
    if (id === FULL_ACCESS_ROLE_ID) {
      throw new BadRequestException(
        'The default Full Access role can’t be deleted',
      );
    }
    await this.findById(id);
    await this.panelRolesRepository.delete(id);
  }
}
