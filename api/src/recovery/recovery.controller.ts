import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { TestScopeGuard, type AuthedRequest } from '../testing/request-scope.guard.js';
import type { RecoveryResponse } from './contract.js';
import { RecoveryService } from './recovery.service.js';

export const RECOVERY = Symbol('RECOVERY');

@Controller('recovery')
@UseGuards(TestScopeGuard)
export class RecoveryController {
  constructor(@Inject(RECOVERY) private readonly recovery: RecoveryService) {}

  @Get(':documentId')
  status(@Req() req: AuthedRequest, @Param('documentId') documentId: string): Promise<RecoveryResponse> {
    return this.recovery.status(req.userId, documentId);
  }

  @Post(':documentId')
  start(@Req() req: AuthedRequest, @Param('documentId') documentId: string, @Body() body: unknown): Promise<RecoveryResponse> {
    return this.recovery.start(req.userId, documentId, body);
  }

  @Post(':documentId/proposals/:proposalId/accept')
  accept(@Req() req: AuthedRequest, @Param('documentId') documentId: string, @Param('proposalId') proposalId: string, @Body() body: unknown): Promise<RecoveryResponse> {
    return this.recovery.decide(req.userId, documentId, proposalId, 'accepted', body);
  }

  @Post(':documentId/proposals/:proposalId/reject')
  reject(@Req() req: AuthedRequest, @Param('documentId') documentId: string, @Param('proposalId') proposalId: string, @Body() body: unknown): Promise<RecoveryResponse> {
    return this.recovery.decide(req.userId, documentId, proposalId, 'rejected', body);
  }
}
