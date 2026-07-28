import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AdminGuard } from './guards/admin.guard';

// AdminGuard has a constructor dependency (UsersService), so any module that
// applies it via @UseGuards(AdminGuard) needs it resolvable through its own
// DI container. Importing this module once does that instead of every
// consumer re-declaring AdminGuard as a provider.
@Module({
  imports: [UsersModule],
  providers: [AdminGuard],
  exports: [AdminGuard],
})
export class AdminGuardModule {}
