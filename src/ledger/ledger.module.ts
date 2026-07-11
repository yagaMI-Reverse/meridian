import { Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';
import { LedgerService } from './ledger.service';

@Module({
  providers: [LedgerService, IdempotencyService],
  exports: [LedgerService, IdempotencyService],
})
export class LedgerModule {}
