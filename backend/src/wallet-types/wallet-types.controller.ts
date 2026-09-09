import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { WalletTypesService } from './wallet-types.service';
import { CreateWalletTypeDto } from './dto/create-wallet-type.dto';
import { UpdateWalletTypeDto } from './dto/update-wallet-type.dto';

const MAX_CARD_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_CARD_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
];

// Wallet types are the "laws" every wallet is bound by, so managing them
// (create/edit/delete) is super-admin-only — a regular admin can still read
// them (findAll, used when creating a wallet) but not change the rules.
@Controller('wallet-types')
@UseGuards(JwtAuthGuard)
export class WalletTypesController {
  constructor(private readonly walletTypesService: WalletTypesService) {}

  @Get()
  findAll() {
    return this.walletTypesService.findAll();
  }

  @Post()
  @UseGuards(SuperAdminGuard)
  create(@Body() dto: CreateWalletTypeDto) {
    return this.walletTypesService.create(dto);
  }

  @Patch(':id')
  @UseGuards(SuperAdminGuard)
  update(@Param('id') id: string, @Body() dto: UpdateWalletTypeDto) {
    return this.walletTypesService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(SuperAdminGuard)
  async remove(@Param('id') id: string) {
    await this.walletTypesService.delete(id);
    return { deleted: true };
  }

  // The logo shown on every wallet-of-this-type's dashboard card in place
  // of the generic brand mark — mirrors UsersController's avatar upload
  // (same save-then-delete-previous shape, own uploads subdirectory).
  @Post(':id/card-image')
  @UseGuards(SuperAdminGuard)
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: MAX_CARD_IMAGE_BYTES } }),
  )
  async setCardImage(
    @Param('id') id: string,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    if (!image) {
      throw new BadRequestException('An image is required');
    }
    if (!ALLOWED_CARD_IMAGE_MIME_TYPES.includes(image.mimetype)) {
      throw new BadRequestException(
        'Image must be a PNG, JPEG, WEBP, or SVG image',
      );
    }
    const filename = this.saveCardImage(id, image);
    const { previousFilename } = await this.walletTypesService.setCardImage(
      id,
      filename,
    );
    if (previousFilename) {
      this.deleteCardImageFile(previousFilename);
    }
    return { cardImageFilename: filename };
  }

  @Delete(':id/card-image')
  @UseGuards(SuperAdminGuard)
  async removeCardImage(@Param('id') id: string) {
    const { previousFilename } =
      await this.walletTypesService.clearCardImage(id);
    if (previousFilename) {
      this.deleteCardImageFile(previousFilename);
    }
    return { deleted: true };
  }

  private saveCardImage(typeId: string, image: Express.Multer.File): string {
    const uploadsDir = join(
      __dirname,
      '..',
      '..',
      'uploads',
      'wallet-type-cards',
    );
    mkdirSync(uploadsDir, { recursive: true });
    const safeName = image.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${typeId}-${randomUUID()}-${safeName}`;
    writeFileSync(join(uploadsDir, filename), image.buffer);
    return filename;
  }

  private deleteCardImageFile(filename: string): void {
    const filePath = join(
      __dirname,
      '..',
      '..',
      'uploads',
      'wallet-type-cards',
      filename,
    );
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }
}
