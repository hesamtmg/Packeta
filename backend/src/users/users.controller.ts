import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { SetPhoneNumberDto } from './dto/set-phone-number.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function avatarUrl(filename: string | null): string | null {
  return filename ? `/uploads/avatars/${filename}` : null;
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    const found = await this.usersService.findById(user.userId);
    if (!found) {
      throw new NotFoundException('User not found');
    }
    return {
      id: found.id,
      email: found.email,
      role: found.role,
      permissions: found.permissions,
      phoneNumber: found.phoneNumber,
      name: found.name,
      nationalCode: found.nationalCode,
      avatarUrl: avatarUrl(found.avatarFilename),
    };
  }

  @Patch('me/phone-number')
  async setPhoneNumber(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetPhoneNumberDto,
  ) {
    const updated = await this.usersService.setPhoneNumber(
      user.userId,
      dto.phoneNumber,
    );
    return { id: updated.id, phoneNumber: updated.phoneNumber };
  }

  @Patch('me/profile')
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    const updated = await this.usersService.updateProfile(user.userId, dto);
    return {
      id: updated.id,
      name: updated.name,
      nationalCode: updated.nationalCode,
    };
  }

  @Post('me/avatar')
  @UseInterceptors(
    FileInterceptor('avatar', { limits: { fileSize: MAX_AVATAR_BYTES } }),
  )
  async setAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() avatar?: Express.Multer.File,
  ) {
    if (!avatar) {
      throw new BadRequestException('An avatar image is required');
    }
    if (!ALLOWED_AVATAR_MIME_TYPES.includes(avatar.mimetype)) {
      throw new BadRequestException(
        'Avatar must be a PNG, JPEG, or WEBP image',
      );
    }
    const filename = this.saveAvatar(user.userId, avatar);
    const { previousFilename } = await this.usersService.setAvatar(
      user.userId,
      filename,
    );
    if (previousFilename) {
      this.deleteAvatarFile(previousFilename);
    }
    return { avatarUrl: avatarUrl(filename) };
  }

  // Writes an uploaded avatar image to a dedicated uploads directory
  // (created on first use) under a collision-proof name, served back via
  // the static file mount in app.module.ts.
  private saveAvatar(userId: string, avatar: Express.Multer.File): string {
    const uploadsDir = join(__dirname, '..', '..', 'uploads', 'avatars');
    mkdirSync(uploadsDir, { recursive: true });
    const safeName = avatar.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${userId}-${randomUUID()}-${safeName}`;
    writeFileSync(join(uploadsDir, filename), avatar.buffer);
    return filename;
  }

  private deleteAvatarFile(filename: string): void {
    const filePath = join(
      __dirname,
      '..',
      '..',
      'uploads',
      'avatars',
      filename,
    );
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }
}
