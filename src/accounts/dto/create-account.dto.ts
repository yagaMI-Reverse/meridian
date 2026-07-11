import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length } from 'class-validator';

export class CreateAccountDto {
  @ApiProperty({ example: 'Globex LLC', minLength: 1, maxLength: 120 })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ example: 'billing@globex.example', description: 'Unique per tenant' })
  @IsEmail()
  @Transform(({ value }: { value: string }) => (typeof value === 'string' ? value.toLowerCase() : value))
  email!: string;
}
