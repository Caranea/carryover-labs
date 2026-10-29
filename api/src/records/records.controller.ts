import { Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { TestScopeGuard, type AuthedRequest } from '../testing/request-scope.guard.js';
import type { RecordsResponse } from './contract.js';
import { RecordsService } from './records.service.js';

export const RECORDS = Symbol('RECORDS');

/** The user's record: every recognised test over time, grouped into charts, plus what was left out and why. */
@Controller('records')
@UseGuards(TestScopeGuard)
export class RecordsController {
  constructor(@Inject(RECORDS) private readonly records: RecordsService) {}

  @Get()
  get(@Req() req: AuthedRequest): Promise<RecordsResponse> {
    return this.records.records(req.userId);
  }

  @Post('retry')
  retry(@Req() req: AuthedRequest): Promise<RecordsResponse> {
    return this.records.retry(req.userId);
  }

}
