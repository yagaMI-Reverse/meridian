import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { ReconciliationService } from './reconciliation.service';

@ApiTags('reconciliation')
@ApiBearerAuth('bearer')
@Roles(UserRole.ADMIN)
@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Post('run')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Run a reconciliation sweep now (ADMIN only)',
    description: 'Compares every materialized balance against SUM(ledger_entries) and stores the report.',
  })
  run() {
    return this.reconciliation.run('manual');
  }

  @Get('latest')
  @ApiOperation({ summary: 'Latest reconciliation report' })
  latest() {
    return this.reconciliation.latest();
  }

  @Get()
  @ApiOperation({ summary: 'Recent reconciliation reports' })
  list() {
    return this.reconciliation.list();
  }
}
