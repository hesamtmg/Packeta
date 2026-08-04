import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ADMIN_SECTIONS } from '../../admin/admin-sections';

export class UpdatePanelRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(ADMIN_SECTIONS, { each: true })
  permissions?: string[];
}
