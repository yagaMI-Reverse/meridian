import { Injectable } from '@nestjs/common';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanDto } from './dto/create-plan.dto';

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  create(user: AuthUser, dto: CreatePlanDto) {
    return this.prisma.withTenant(user.tenantId, (tx) =>
      tx.plan.create({
        data: {
          tenantId: user.tenantId,
          code: dto.code,
          name: dto.name,
          amountCents: dto.amountCents,
          interval: dto.interval,
        },
      }),
    );
  }

  list(user: AuthUser) {
    return this.prisma.withTenant(user.tenantId, (tx) =>
      tx.plan.findMany({ orderBy: { amountCents: 'asc' } }),
    );
  }
}
