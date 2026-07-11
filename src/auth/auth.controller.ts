import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Exchange tenant credentials for a JWT',
    description: 'The token carries the tenant id; every subsequent query is row-level-security scoped to it.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        accessToken: 'eyJhbGciOiJIUzI1NiIs…',
        tokenType: 'Bearer',
        expiresIn: 3600,
        tenant: { id: 'f1f86d78-…', slug: 'northwind', name: 'Northwind Robotics' },
        user: { id: '0b56a3fd-…', email: 'admin@northwind.demo', role: 'ADMIN' },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Unknown tenant, unknown user or wrong password' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }
}
