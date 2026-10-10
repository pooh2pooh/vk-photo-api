import type { AuthResult, PhotosPage, SessionState } from "./types.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ErrorShape {
  code?: string;
  message?: string;
  details?: unknown;
}

type ResponseShape<T> = T & { error?: ErrorShape };

interface RequestInit {
  method?: "GET" | "POST";
  params?: Record<string, string | number>;
  body?: unknown;
}

const BASE = "./api.php";

const REQUEST_TIMEOUT_MS = 8000;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError" : false;
}

function loader(): ShellLoader | undefined {
  return window.__VK_LOADER__;
}

function now(): number {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

async function api<T>(action: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  const started = now();
  loader()?.net(`→ ${method} ${action}`);

  const url = new URL(`${BASE}?action=${encodeURIComponent(action)}`, window.location.href);
  for (const [key, value] of Object.entries(init.params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    const ms = Math.round(now() - started);
    if (isAbortError(error)) {
      loader()?.error(`✖ ${action} TIMEOUT ${ms}мс`);
      throw new ApiError(0, "TIMEOUT", "Сервер не ответил вовремя", error);
    }
    loader()?.error(`✖ ${action} NETWORK ${ms}мс`);
    throw new ApiError(0, "NETWORK", "Не удалось связаться с сервером", error);
  } finally {
    window.clearTimeout(timer);
  }

  let data: ResponseShape<T> | undefined;
  try {
    data = (await response.json()) as ResponseShape<T>;
  } catch {
    // тело не JSON — оставляем undefined
  }

  const ms = Math.round(now() - started);
  const err = data?.error;
  if (!response.ok || err) {
    const code = err?.code ?? `HTTP_${response.status}`;
    loader()?.error(`← ${action} ${response.status} ${ms}мс — ${code}`);
    throw new ApiError(
      response.status,
      code,
      err?.message ?? `Ошибка HTTP ${response.status}`,
      err?.details,
    );
  }
  loader()?.ok(`← ${action} ${response.status} ${ms}мс`);
  return data as T;
}

export const checkSession = (): Promise<SessionState> => api("session");

export const login = (username: string, password: string): Promise<AuthResult> =>
  api("login", { method: "POST", body: { username, password } });

export const logout = (): Promise<AuthResult> => api("logout");

export function fetchPhotos(input: { offset: number; count: number }): Promise<PhotosPage> {
  return api<PhotosPage>("photos", { params: { offset: input.offset, count: input.count } });
}

export const GROUP_AUTH_ERROR_CODE = "VK_27";