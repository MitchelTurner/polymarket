import { Controller, Get, Headers, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';

@Controller('admin')
export class AdminController {
  @Get('status')
  status(@Headers('authorization') authorization?: string) {
    const secret = process.env.ADMIN_TOKEN;
    const prefix = 'Bearer ';
    const provided = authorization?.startsWith(prefix) ? authorization.slice(prefix.length) : '';
    if (!secret || secret.length < 32 || !provided ||
        !timingSafeEqual(createHash('sha256').update(secret).digest(),
          createHash('sha256').update(provided).digest())) {
      throw new UnauthorizedException();
    }
    return { status: 'ok' };
  }
}
