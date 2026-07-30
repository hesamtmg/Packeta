import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Marks a route as reachable without a JWT, despite its controller's
// class-level @UseGuards(JwtAuthGuard) — see JwtAuthGuard.canActivate.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
