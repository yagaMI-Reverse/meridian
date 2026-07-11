import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { SystemPrismaService } from '../prisma/system-prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly system: SystemPrismaService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness + database connectivity' })
  async health() {
    let database = 'up';
    try {
      await this.system.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }
    return { status: database === 'up' ? 'ok' : 'degraded', database, uptimeSeconds: Math.round(process.uptime()) };
  }
}
