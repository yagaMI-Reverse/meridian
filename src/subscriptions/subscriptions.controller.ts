import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('subscriptions')
@ApiBearerAuth('bearer')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a subscription and post its first charge (idempotent)',
    description:
      'Subscription + CHARGE ledger entry + balance update commit in a single transaction — a retry cannot double-charge.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Client-generated key; retries with the same key replay the original response',
  })
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSubscriptionDto,
    @IdempotencyKey() key: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const outcome = await this.subscriptions.create(user, dto, key);
    if (outcome.replayed) res.setHeader('Idempotency-Replayed', 'true');
    res.status(outcome.status);
    return outcome.body;
  }

  @Get()
  @ApiOperation({ summary: 'List subscriptions of the current tenant' })
  list(@CurrentUser() user: AuthUser) {
    return this.subscriptions.list(user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel a subscription (no retroactive ledger effect)' })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptions.cancel(user, id);
  }
}
