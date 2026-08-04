import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ADMIN_SECTIONS } from '../../admin/admin-sections';

export class CreatePanelRoleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsArray()
  @ArrayUnique()
  @IsIn(ADMIN_SECTIONS, { each: true })
  permissions: string[];
}
