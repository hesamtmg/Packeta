import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

// Global because UsersService is a dependency of AdminGuard, which is applied
// via @UseGuards() from several unrelated modules (wallet-types, admin) —
// Nest resolves a decorator-applied guard's own constructor deps against the
// consuming controller's module, not the guard's home module, so UsersService
// needs to be reachable from anywhere without each of those modules having to
// import UsersModule explicitly.
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
