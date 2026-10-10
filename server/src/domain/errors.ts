export type ErrorCode =
  | "CONFIG_INVALID"
  | "VK_UNAUTHORIZED"
  | "VK_RATE_LIMITED"
  | "VK_CAPTCHA_REQUIRED"
  | "VK_NOT_FOUND"
  | "VK_UNAVAILABLE"
  | "VK_UNKNOWN"
  | "VALIDATION_FAILED"
  | "UPSTREAM_TIMEOUT"
  | "INTERNAL";

export interface AppErrorOptions {
  statusCode?: number;
  retryable?: boolean;
  cause?: unknown;
  details?: Record<string, unknown>;
}

/**
 * Single error type crossing all layers. The presentation layer only needs to
 * read `code` + `statusCode`, infrastructure decides `retryable`.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.statusCode = options.statusCode ?? 500;
    this.retryable = options.retryable ?? false;
    if (options.details) this.details = options.details;
  }

  static isAppError(value: unknown): value is AppError {
    return value instanceof AppError;
  }
}
