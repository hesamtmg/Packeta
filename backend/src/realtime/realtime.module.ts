import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RealtimeGateway } from './realtime.gateway';

// UsersService isn't imported here — UsersModule is @Global (see its own
// comment), so it's already reachable. JwtModule is configured the same way
// AuthModule configures it, against the same jwt.secret/jwt.expiresIn keys,
// so the gateway verifies the same tokens REST issues without duplicating
// any secret/config logic.
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: { expiresIn: config.get<string>('jwt.expiresIn') },
      }),
    }),
  ],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
