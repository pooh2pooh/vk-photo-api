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

async function api<T>(action: string, init: RequestInit = {}): Promise<T> {
  const url = new URL(`${BASE}?action=${encodeURIComponent(action)}`, window.location.href);
  for (const [key, value] of Object.entries(init.params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (error) {
    throw new ApiError(0, "NETWORK", "Не удалось связаться с сервером", error);
  }

  let data: ResponseShape<T> | undefined;
  try {
    data = (await response.json()) as ResponseShape<T>;
  } catch {
    // тело не JSON — оставляем undefined
  }

  const err = data?.error;
  if (!response.ok || err) {
    throw new ApiError(
      response.status,
      err?.code ?? `HTTP_${response.status}`,
      err?.message ?? `Ошибка HTTP ${response.status}`,
      err?.details,
    );
  }
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