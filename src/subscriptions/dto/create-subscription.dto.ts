import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Length } from 'class-validator';

export class CreateSubscriptionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  accountId!: string;

  @ApiProperty({ example: 'growth', description: 'Plan code within the current tenant' })
  @IsString()
  @Length(2, 50)
  planCode!: string;
}
