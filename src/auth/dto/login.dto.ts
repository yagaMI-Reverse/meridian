import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'northwind', description: 'Tenant slug the user belongs to' })
  @IsString()
  @Length(2, 50)
  tenant!: string;

  @ApiProperty({ example: 'admin@northwind.demo' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'demo-password' })
  @IsString()
  @MaxLength(200)
  password!: string;
}
