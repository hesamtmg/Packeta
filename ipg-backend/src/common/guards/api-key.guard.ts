import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

// Guards the merchant-facing endpoints (create/verify a payment) with a
// shared secret. The browser-facing confirm/cancel endpoints don't use this
// guard — those are protected only by the unguessable authority, same as a
// real payment page.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header('x-ipg-api-key');
    const expected = this.configService.get<string>('ipgApiKey');
    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Invalid or missing API key');
    }
    return true;
  }
}
