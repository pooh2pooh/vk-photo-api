import type { PhotosPage } from "./types.js";

export interface ApiErrorShape {
  code: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface FetchPhotosParams {
  offset: number;
  count: number;
  signal?: AbortSignal;
}

export async function fetchPhotos(params: FetchPhotosParams): Promise<PhotosPage> {
  const query = new URLSearchParams({
    offset: String(params.offset),
    count: String(params.count),
  });

  const response = await fetch(`/api/photos?${query.toString()}`, {
    signal: params.signal,
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    let code = "HTTP_ERROR";
    let message = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { error?: ApiErrorShape };
      if (body.error) {
        code = body.error.code;
        message = body.error.message;
      }
    } catch {
      // response had no JSON body; keep defaults
    }
    throw new ApiError(response.status, code, message);
  }

  return (await response.json()) as PhotosPage;
}
