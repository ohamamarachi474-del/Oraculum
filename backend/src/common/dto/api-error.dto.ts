import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Structured validator output surfaced on 400 validation errors.
 */
export class ApiErrorFieldDto {
  @ApiProperty({ example: 'email' })
  field: string;

  @ApiProperty({ type: [String], example: ['email must be an email'] })
  constraints: string[];

  @ApiPropertyOptional({ type: () => [ApiErrorFieldDto] })
  children?: ApiErrorFieldDto[];
}

/**
 * BE-01 — Standard public error response.
 *
 * This is the ONLY shape the global exception filter sends to clients.
 * Every field except `fields` is always present, so consumers can rely on
 * it regardless of where the error originated. Diagnostic details (stack
 * traces, raw exception messages for 5xx errors, upstream payloads) are
 * never included here — they are written to server-side logs keyed by
 * `correlationId` instead.
 *
 *  - `correlationId` lets support staff tie a user-visible error back
 *    to the request log line.
 *  - `fields` is only present for 400 validation errors so Swagger UI
 *    can render the structured validator output.
 */
export class ApiErrorDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({ example: 'Bad Request' })
  error: string;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: 'Validation failed',
  })
  message: string | string[];

  @ApiProperty({
    example: '5e3b1c9a-1234-4abc-9876-abcdef012345',
    description:
      'Request correlation ID (BE-08). Echoed in the x-correlation-id response header.',
  })
  correlationId: string;

  @ApiProperty({ example: '2026-07-23T12:00:00.000Z' })
  timestamp: string;

  @ApiProperty({ example: '/api/v1/users' })
  path: string;

  @ApiPropertyOptional({ type: () => [ApiErrorFieldDto] })
  fields?: ApiErrorFieldDto[];

  /**
   * Builds a public error body containing only whitelisted keys, so no
   * extra properties from an exception payload can leak to clients.
   */
  static create(input: {
    statusCode: number;
    error: string;
    message: string | string[];
    correlationId: string;
    path: string;
    timestamp?: string;
    fields?: ApiErrorFieldDto[];
  }): ApiErrorDto {
    const dto = new ApiErrorDto();
    dto.statusCode = input.statusCode;
    dto.error = input.error;
    dto.message = input.message;
    dto.correlationId = input.correlationId;
    dto.timestamp = input.timestamp ?? new Date().toISOString();
    dto.path = input.path;
    if (input.fields && input.fields.length > 0) {
      dto.fields = input.fields;
    }
    return dto;
  }
}
