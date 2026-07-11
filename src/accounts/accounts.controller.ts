import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { IdempotencyKey } from '../common/decorators/idempotency-key.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AccountsService, MutationOutcome } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { LedgerQueryDto } from './dto/ledger-query.dto';
import { AdjustmentDto, CreditDto, PaymentDto } from './dto/money.dto';

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  required: true,
  description: 'Client-generated key; retries with the same key replay the original response',
};

function respond(res: Response, outcome: MutationOutcome) {
  if (outcome.replayed) res.setHeader('Idempotency-Replayed', 'true');
  res.status(outcome.status);
  return outcome.body;
}

@ApiTags('accounts')
@ApiBearerAuth('bearer')
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a customer account' })
  @ApiCreatedResponse({ description: 'Account created (409 if the email already exists in this tenant)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAccountDto) {
    return this.accounts.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List accounts of the current tenant' })
  list(@CurrentUser() user: AuthUser) {
    return this.accounts.list(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one account with its materialized balance' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.get(user, id);
  }

  @Get(':id/ledger')
  @ApiOperation({ summary: 'Page through the append-only ledger of an account' })
  ledger(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: LedgerQueryDto,
  ) {
    return this.accounts.ledgerPage(user, id, query);
  }

  @Post(':id/payments')
  @ApiOperation({
    summary: 'Record a payment (idempotent)',
    description: 'Appends a PAYMENT entry and updates the balance in one transaction.',
  })
  @ApiHeader(IDEMPOTENCY_HEADER)
  async payment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PaymentDto,
    @IdempotencyKey() key: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(res, await this.accounts.recordPayment(user, id, dto, key));
  }

  @Post(':id/credits')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Grant a credit (idempotent, ADMIN only)' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  async credit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreditDto,
    @IdempotencyKey() key: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(res, await this.accounts.recordCredit(user, id, dto, key));
  }

  @Post(':id/adjustments')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Signed manual correction (idempotent, ADMIN only)' })
  @ApiHeader(IDEMPOTENCY_HEADER)
  async adjustment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustmentDto,
    @IdempotencyKey() key: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    return respond(res, await this.accounts.recordAdjustment(user, id, dto, key));
  }
}
