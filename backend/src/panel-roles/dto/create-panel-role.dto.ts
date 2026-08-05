import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PANEL_ROLE_PERMISSIONS } from '../../admin/admin-sections';

export class CreatePanelRoleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsArray()
  @ArrayUnique()
  @IsIn(PANEL_ROLE_PERMISSIONS, { each: true })
  permissions: string[];
}
