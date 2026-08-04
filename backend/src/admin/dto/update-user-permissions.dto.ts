import { ArrayUnique, IsArray, IsIn } from 'class-validator';
import { ADMIN_SECTIONS } from '../admin-sections';

export class UpdateUserPermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsIn(ADMIN_SECTIONS, { each: true })
  permissions: string[];
}
