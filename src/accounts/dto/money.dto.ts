import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive, IsString, Max, MaxLength, NotEquals } from 'class-validator';

const MAX_AMOUNT_CENTS = 1_000_000_000_000; // $10B — sanity cap for a demo ledger

export class PaymentDto {
  @ApiProperty({ example: 4900, description: 'Positive amount in cents' })
  @IsInt()
  @IsPositive()
  @Max(MAX_AMOUNT_CENTS)
  amountCents!: number;

  @ApiPropertyOptional({ example: 'Invoice #1042 wire transfer' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class CreditDto {
  @ApiProperty({ example: 1500, description: 'Positive amount in cents' })
  @IsInt()
  @IsPositive()
  @Max(MAX_AMOUNT_CENTS)
  amountCents!: number;

  @ApiProperty({ example: 'Goodwill credit — support outage' })
  @IsString()
  @MaxLength(500)
  description!: string;
}

export class AdjustmentDto {
  @ApiProperty({
    example: -250,
    description: 'SIGNED amount in cents — admin corrections can go either way',
  })
  @IsInt()
  @NotEquals(0)
  @Max(MAX_AMOUNT_CENTS)
  amountCents!: number;

  @ApiProperty({ example: 'Manual correction: double-charged migration fee' })
  @IsString()
  @MaxLength(500)
  description!: string;
}
