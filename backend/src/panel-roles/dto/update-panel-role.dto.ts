import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PANEL_ROLE_PERMISSIONS } from '../../admin/admin-sections';

export class UpdatePanelRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(PANEL_ROLE_PERMISSIONS, { each: true })
  permissions?: string[];

  @IsOptional()
  @IsBoolean()
  isDefaultForSignup?: boolean;
}
