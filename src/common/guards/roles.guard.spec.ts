import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';

function contextWithUser(role?: UserRole): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => (role ? { user: { role } } : {}) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guardWith = (required?: UserRole[]) => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(required) } as unknown as Reflector;
    return new RolesGuard(reflector);
  };

  it('allows routes without role metadata', () => {
    expect(guardWith(undefined).canActivate(contextWithUser(UserRole.ANALYST))).toBe(true);
  });

  it('allows a user holding a required role', () => {
    expect(guardWith([UserRole.ADMIN]).canActivate(contextWithUser(UserRole.ADMIN))).toBe(true);
  });

  it('rejects a user missing the required role', () => {
    expect(() => guardWith([UserRole.ADMIN]).canActivate(contextWithUser(UserRole.ANALYST))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects when no user is attached at all', () => {
    expect(() => guardWith([UserRole.ADMIN]).canActivate(contextWithUser(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
