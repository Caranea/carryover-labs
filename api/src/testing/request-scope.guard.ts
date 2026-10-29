import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthedRequest extends Request {
  userId: string;
}

export type TokenVerifier = (token: string) => Promise<{ sub?: string }>;
export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');


/** Only the legacy storage test harness registers this guard and supplies its verifier. */
@Injectable()
export class TestScopeGuard implements CanActivate {
  constructor(@Inject(TOKEN_VERIFIER) private readonly verify: TokenVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw new UnauthorizedException('Missing test scope.');
    try {
      const payload = await this.verify(token);
      if (!payload.sub) throw new Error('no subject');
      req.userId = payload.sub;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid test scope.');
    }
  }
}
