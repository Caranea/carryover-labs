import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import type { Request } from 'express';
import type { AppConfig } from '../config.js';

export interface AuthedRequest extends Request {
  userId: string;
}

export type TokenVerifier = (token: string) => Promise<{ sub?: string }>;
export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

export function clerkVerifier(config: AppConfig): TokenVerifier {
  return (token) =>
    verifyToken(token, {
      secretKey: config.clerkSecretKey,
      jwtKey: config.clerkJwtKey,
      authorizedParties: config.authorizedParties,
    });
}

/** Every document route requires a valid Clerk session token. */
@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(@Inject(TOKEN_VERIFIER) private readonly verify: TokenVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw new UnauthorizedException('Sign in to continue.');
    try {
      const payload = await this.verify(token);
      if (!payload.sub) throw new Error('no subject');
      req.userId = payload.sub;
      return true;
    } catch {
      throw new UnauthorizedException('Your session has ended. Sign in again.');
    }
  }
}
