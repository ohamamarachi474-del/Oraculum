import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { getCorrelationId } from '../context/correlation-context';
import { ApiErrorDto, ApiErrorFieldDto } from '../dto/api-error.dto';

const INTERNAL_ERROR_MESSAGE = 'Internal server error';
const INTERNAL_ERROR_LABEL = 'Internal Server Error';

/**
 * BE-08 — Global exception filter.
 *
 * Normalises every error response into the stable public `ApiErrorDto`
 * shape:
 *
 *   {
 *     statusCode: number,
 *     error: string,
 *     message: string | string[],
 *     correlationId: string,
 *     timestamp: string,
 *     path: string,
 *     fields?: ApiErrorFieldDto[]   // 400 validation errors only
 *   }
 *
 * Only whitelisted keys are sent to clients. For 5xx errors the message is
 * always generic so internal details never leak; the original exception
 * (message, payload and stack) is logged server-side against the
 * correlation ID so operators can still diagnose the failure.
 *
 * The correlation ID is read from the AsyncLocalStorage context opened
 * by `CorrelationIdMiddleware`, so service-level throws are still
 * connected to the originating request.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { correlationId?: string }>();

    const correlationId =
      request.correlationId ?? getCorrelationId() ?? 'unknown';
    const requestPath = request.originalUrl ?? request.url ?? '';
    const method = request.method ?? 'UNKNOWN';

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const isServerError = status >= 500;
    const parsed = this.parseException(exception, status);

    const body = ApiErrorDto.create({
      statusCode: status,
      error: isServerError ? INTERNAL_ERROR_LABEL : parsed.error,
      message: isServerError ? INTERNAL_ERROR_MESSAGE : parsed.message,
      correlationId,
      path: requestPath,
      fields: isServerError ? undefined : parsed.fields,
    });

    this.log(exception, {
      method,
      path: requestPath,
      status,
      correlationId,
      detail: parsed.diagnostic,
    });

    if (!response.headersSent && typeof response.setHeader === 'function') {
      response.setHeader('x-correlation-id', correlationId);
    }

    response.status(status).json(body);
  }

  private parseException(
    exception: unknown,
    status: number,
  ): {
    error: string;
    message: string | string[];
    fields?: ApiErrorFieldDto[];
    diagnostic: string;
  } {
    const defaultLabel = this.reasonPhrase(status);

    if (exception instanceof HttpException) {
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return {
          error: defaultLabel,
          message: payload,
          diagnostic: payload,
        };
      }

      if (payload && typeof payload === 'object') {
        const obj = payload as Record<string, unknown>;
        const message = this.normaliseMessage(obj.message, exception.message);
        const error =
          typeof obj.error === 'string' && obj.error.trim() !== ''
            ? obj.error
            : defaultLabel;
        const fields = Array.isArray(obj.fields)
          ? (obj.fields as ApiErrorFieldDto[])
          : undefined;

        return {
          error,
          message,
          fields,
          diagnostic: this.safeStringify(obj),
        };
      }

      return {
        error: defaultLabel,
        message: exception.message,
        diagnostic: exception.message,
      };
    }

    if (exception instanceof Error) {
      return {
        error: defaultLabel,
        message: INTERNAL_ERROR_MESSAGE,
        diagnostic: `${exception.name}: ${exception.message}`,
      };
    }

    return {
      error: defaultLabel,
      message: INTERNAL_ERROR_MESSAGE,
      diagnostic: `Non-error thrown: ${this.safeStringify(exception)}`,
    };
  }

  private log(
    exception: unknown,
    ctx: {
      method: string;
      path: string;
      status: number;
      correlationId: string;
      detail: string;
    },
  ): void {
    const line = `${ctx.method} ${ctx.path} ${ctx.status} [cid=${ctx.correlationId}]: ${ctx.detail}`;

    if (ctx.status >= 500) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(line, stack);
    } else {
      this.logger.warn(line);
    }
  }

  private normaliseMessage(
    value: unknown,
    fallback: string,
  ): string | string[] {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value.map((v) => (typeof v === 'string' ? v : this.safeStringify(v)));
    }
    return fallback;
  }

  private reasonPhrase(status: number): string {
    const name = HttpStatus[status];
    if (typeof name !== 'string') {
      return status >= 500 ? INTERNAL_ERROR_LABEL : 'Error';
    }
    return name
      .toLowerCase()
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  private safeStringify(value: unknown): string {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }
}
