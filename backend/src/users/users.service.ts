import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from './entities/user.entity';
import { ADMIN_SECTIONS } from '../admin/admin-sections';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
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
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    // A freshly-promoted ADMIN starts with every section granted — matches
    // what "being an admin" meant before this permission system existed.
    // A super-admin can narrow it down afterwards via setPermissions.
    if (
      role === UserRole.ADMIN &&
      user.role !== UserRole.ADMIN &&
      !user.permissions?.length
    ) {
      user.permissions = [...ADMIN_SECTIONS];
    }
    user.role = role;
    return this.usersRepository.save(user);
  }

  async setPermissions(id: string, permissions: string[]): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.role !== UserRole.ADMIN) {
      throw new BadRequestException(
        'Only regular ADMIN accounts have grantable panel sections — SUPER_ADMIN already has full access',
      );
    }
    user.permissions = permissions;
    return this.usersRepository.save(user);
  }
}
