import { IsIn } from 'class-validator';
import { UserRole } from '../../users/entities/user.entity';

// SUPER_ADMIN is deliberately excluded — granting it is a privilege
// escalation that stays off this panel entirely (see
// backend/src/scripts/promote-to-admin.ts). This endpoint can only move a
// user between USER and ADMIN.
export class UpdateUserRoleDto {
  @IsIn([UserRole.USER, UserRole.ADMIN])
  role: UserRole.USER | UserRole.ADMIN;
}
