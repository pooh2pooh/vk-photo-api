import { AppError } from "../../domain/errors.js";

interface VkErrorPayload {
  error_code: number;
  error_msg: string;
  error_subcode?: number;
}

interface VkApiResponse<T> {
  response?: T;
  error?: VkErrorPayload;
}

export interface VkHttpClientOptions {
  token: string;
  apiVersion: string;
  timeoutMs: number;
  retryAttempts: number;
  baseUrl?: string;
  /** Structured logger; keeps infrastructure free of a concrete logger. */
  log?: (event: Record<string, unknown>) => void;
}

const RETRYABLE_VK_CODES = new Set([6, 10, 29]);

function mapVkError(error: VkErrorPayload): AppError {
  const { error_code, error_msg } = error;

  if (error_code === 5) {
    return new AppError("VK_UNAUTHORIZED", error_msg, { statusCode: 401, details: { error_code } });
  }
  if (RETRYABLE_VK_CODES.has(error_code)) {
    return new AppError("VK_RATE_LIMITED", error_msg, {
      statusCode: 429,
      retryable: true,
      details: { error_code },
    });
  }
  if (error_code === 14) {
    return new AppError("VK_CAPTCHA_REQUIRED", error_msg, {
      statusCode: 403,
      details: { error_code },
    });
  }
  if (error_code === 15 || error_code === 200 || error_code === 203) {
    return new AppError("VK_NOT_FOUND", error_msg, { statusCode: 404, details: { error_code } });
  }

  return new AppError("VK_UNKNOWN", error_msg, { statusCode: 502, details: { error_code } });
}

/**
 * Thin typed transport over the VK HTTP API. Owns timeouts, retries and
 * conversion of VK error payloads into `AppError`.
 */
export class VkHttpClient {
  private readonly baseUrl: string;

  constructor(private readonly options: VkHttpClientOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.vk.com/method";
  }

  async call<T>(method: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) body.set(key, String(value));
    }
    body.set("access_token", this.options.token);
    body.set("v", this.options.apiVersion);

    const attempts = Math.max(1, this.options.retryAttempts);
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await this.send<T>(method, body);
      } catch (error) {
        lastError = error;
        const retryable = AppError.isAppError(error) && error.retryable;
        if (!retryable || attempt >= attempts) throw error;

        const delay = Math.round(Math.random() * Math.min(4_000, 250 * 2 ** (attempt - 1)));
        this.options.log?.({ level: "warn", msg: "vk request retry", method, attempt, delay });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  private async send<T>(method: string, body: URLSearchParams): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: controller.signal,
      });

      if (response.status >= 500) {
        throw new AppError("VK_UNAVAILABLE", `VK responded with ${response.status}`, {
          statusCode: 502,
          retryable: true,
        });
      }

      const payload = (await response.json()) as VkApiResponse<T>;

      if (payload.error) throw mapVkError(payload.error);
      if (payload.response === undefined) {
        throw new AppError("VK_UNKNOWN", "VK response contained no data", { statusCode: 502 });
      }
      return payload.response;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new AppError("UPSTREAM_TIMEOUT", `VK request timed out after ${this.options.timeoutMs}ms`, {
          statusCode: 504,
          retryable: true,
          cause: error,
        });
      }
      if (error instanceof TypeError) {
        throw new AppError("VK_UNAVAILABLE", "Network failure while calling VK", {
          statusCode: 502,
          retryable: true,
          cause: error,
        });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
