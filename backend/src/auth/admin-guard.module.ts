import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AdminGuard } from './guards/admin.guard';
import { SuperAdminGuard } from './guards/super-admin.guard';

// AdminGuard/SuperAdminGuard both have a constructor dependency
// (UsersService), so any module that applies them via @UseGuards(...) needs
// it resolvable through its own DI container. Importing this module once
// does that instead of every consumer re-declaring the guards as providers.
@Module({
  imports: [UsersModule],
  providers: [AdminGuard, SuperAdminGuard],
  exports: [AdminGuard, SuperAdminGuard],
})
export class AdminGuardModule {}
