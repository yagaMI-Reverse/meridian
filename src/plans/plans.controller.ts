import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CreatePlanDto } from './dto/create-plan.dto';
import { PlansService } from './plans.service';

@ApiTags('plans')
@ApiBearerAuth('bearer')
@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a billing plan (ADMIN only)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePlanDto) {
    return this.plans.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List plans of the current tenant' })
  list(@CurrentUser() user: AuthUser) {
    return this.plans.list(user);
  }
}
