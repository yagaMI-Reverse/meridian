import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SystemPrismaService } from '../prisma/system-prisma.service';
import { LoginDto } from './dto/login.dto';
import { verifyPassword } from './password.util';

@Injectable()
export class AuthService {
  constructor(
    // Auth runs pre-tenant-context, so it uses the system client: it must
    // resolve the tenant before an `app.tenant_id` GUC can exist.
    private readonly system: SystemPrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const tenant = await this.system.tenant.findUnique({ where: { slug: dto.tenant } });
    if (!tenant) throw new UnauthorizedException('Invalid credentials');

    const user = await this.system.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: dto.email.toLowerCase() } },
    });
    if (!user || !(await verifyPassword(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      tid: tenant.id,
      email: user.email,
      role: user.role,
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: 3600,
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      user: { id: user.id, email: user.email, role: user.role },
    };
  }
}
