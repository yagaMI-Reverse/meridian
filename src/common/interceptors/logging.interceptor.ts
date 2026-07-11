import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuthUser } from '../decorators/current-user.decorator';

/**
 * Structured request logging with a per-request correlation id, echoed back
 * as the `X-Request-Id` response header.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('http');

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<{ method: string; url: string; user?: AuthUser }>();
    const res = http.getResponse<{ statusCode: number; setHeader: (k: string, v: string) => void }>();

    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    const startedAt = Date.now();

    const line = (status: number) =>
      `${req.method} ${req.url} ${status} ${Date.now() - startedAt}ms tenant=${req.user?.tenantId ?? '-'} rid=${requestId}`;

    return next.handle().pipe(
      tap({
        next: () => this.logger.log(line(res.statusCode)),
        error: (err: { status?: number }) => this.logger.warn(line(err.status ?? 500)),
      }),
    );
  }
}
