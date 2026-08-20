import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from './entities/user.entity';
import { PanelRole } from '../panel-roles/entities/panel-role.entity';
import { FULL_ACCESS_ROLE_ID } from '../admin/admin-sections';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(PanelRole)
    private readonly panelRolesRepository: Repository<PanelRole>,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();
  }

  findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  // Used by the IPG's phone+OTP step to find which account a phone number
  // belongs to. Only ever matches accounts that have set one.
  findByPhoneNumber(phoneNumber: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { phoneNumber } });
  }

  async setPhoneNumber(id: string, phoneNumber: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    user.phoneNumber = phoneNumber;
    try {
      return await this.usersRepository.save(user);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException(
          'This phone number is already registered to another account',
        );
      }
      throw error;
    }
  }

  async updateProfile(
    id: string,
    updates: { name?: string; nationalCode?: string },
  ): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (updates.name !== undefined) {
      user.name = updates.name.trim() || null;
    }
    if (updates.nationalCode !== undefined) {
      user.nationalCode = updates.nationalCode.length
        ? updates.nationalCode
        : null;
    }
    try {
      return await this.usersRepository.save(user);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException(
          'This national code is already registered to another account',
        );
      }
      throw error;
    }
  }

  // Returns the previous filename (if any) so the controller can delete the
  // now-orphaned file off disk after the DB row is updated — never before,
  // so a failed save doesn't leave the user's row pointing at a deleted file.
  async setAvatar(
    id: string,
    filename: string,
  ): Promise<{
    user: User;
    previousFilename: string | null;
  }> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const previousFilename = user.avatarFilename;
    user.avatarFilename = filename;
    const saved = await this.usersRepository.save(user);
    return { user: saved, previousFilename };
  }

  findAll(): Promise<User[]> {
    return this.usersRepository.find({ order: { createdAt: 'ASC' } });
  }

  async setRole(id: string, role: UserRole): Promise<User> {
    // Belt and suspenders alongside UpdateUserRoleDto's @IsIn: this method
    // takes a plain UserRole, so nothing at the type level stops some other
    // future caller from passing SUPER_ADMIN — granting it must always go
    // through the CLI script (backend/src/scripts/promote-to-admin.ts), not
    // this panel-facing path.
    if (role === UserRole.SUPER_ADMIN) {
      throw new BadRequestException(
        'SUPER_ADMIN cannot be granted from the admin panel',
      );
    }
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    await this.usersRepository.update(id, { role });

    // A freshly-promoted ADMIN starts on the Full Access role — matches
    // what "being an admin" meant before this permission system existed. A
    // super-admin (or anyone holding the "roles" section) can reassign it
    // afterwards via setPanelRole. Best-effort: if that seeded role was
    // deleted, promotion still succeeds, just with no role assigned yet.
    // Uses a raw column update rather than save() on the loaded entity —
    // user.panelRole is an eager-loaded relation object, and mixing that
    // with a direct panelRoleId change on the same entity is ambiguous for
    // TypeORM's persister.
    if (
      role === UserRole.ADMIN &&
      user.role !== UserRole.ADMIN &&
      !user.panelRoleId
    ) {
      const fullAccess = await this.panelRolesRepository.findOne({
        where: { id: FULL_ACCESS_ROLE_ID },
      });
      if (fullAccess) {
        await this.usersRepository.update(id, { panelRoleId: fullAccess.id });
      }
    }
    return (await this.findById(id))!;
  }

  async setPanelRole(id: string, panelRoleId: string | null): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.role === UserRole.SUPER_ADMIN) {
      throw new BadRequestException(
        'SUPER_ADMIN already has full access and cannot be assigned a panel role',
      );
    }
    if (panelRoleId) {
      const role = await this.panelRolesRepository.findOne({
        where: { id: panelRoleId },
      });
      if (!role) {
        throw new NotFoundException('Role not found');
      }
    }
    await this.usersRepository.update(id, { panelRoleId });
    return (await this.findById(id))!;
  }
}
