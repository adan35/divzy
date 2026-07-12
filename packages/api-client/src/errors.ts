import type { ApiErrorBody } from '@divzy/shared';

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code?: string,
    readonly body?: ApiErrorBody | unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isUnauthorized(): boolean {
    return this.statusCode === 401;
  }
  get isForbidden(): boolean {
    return this.statusCode === 403;
  }
  get isNotFound(): boolean {
    return this.statusCode === 404;
  }
  get isValidation(): boolean {
    return this.statusCode === 400 || this.statusCode === 422;
  }
}

export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Network request failed');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}
