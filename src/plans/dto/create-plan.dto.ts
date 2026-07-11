import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlanInterval } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsPositive, IsString, Length, Matches, Max } from 'class-validator';

export class CreatePlanDto {
  @ApiProperty({ example: 'growth', pattern: '^[a-z0-9-]+$' })
  @IsString()
  @Length(2, 50)
  @Matches(/^[a-z0-9-]+$/, { message: 'code must be lowercase letters, digits and dashes' })
  code!: string;

  @ApiProperty({ example: 'Growth' })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ example: 19900, description: 'Price per interval in cents' })
  @IsInt()
  @IsPositive()
  @Max(1_000_000_000)
  amountCents!: number;

  @ApiPropertyOptional({ enum: PlanInterval, default: PlanInterval.MONTHLY })
  @IsOptional()
  @IsEnum(PlanInterval)
  interval?: PlanInterval;
}
