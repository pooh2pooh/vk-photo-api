import { API_BASE, getConfig, hasToken } from "./config.js";
import type { Photo, PhotosPage } from "./types.js";

interface VkErrorPayload {
  error_code: number;
  error_msg: string;
}

interface VkRawPhotoSize {
  type?: string;
  url?: string;
  width?: number;
  height?: number;
}

interface VkRawPhoto {
  id: number;
  owner_id: number;
  album_id: number;
  width?: number;
  height?: number;
  text?: string;
  date: number;
  sizes?: VkRawPhotoSize[];
}

interface VkPhotosResponse {
  count: number;
  items: VkRawPhoto[];
}

export function describeVkError(errorCode: number, fallback: string): string {
  switch (errorCode) {
    case 5:
      return "Ошибка авторизации: неверный access token";
    case 6:
    case 29:
      return "Слишком много запросов к VK, попробуйте позже";
    case 14:
      return "VK требует капчу — попробуйте позже";
    case 100:
      return "VK: неверные параметры запроса";
    case 200:
    case 203:
      return "Нет доступа к альбому";
    default:
      return fallback || `Ошибка VK (код ${errorCode})`;
  }
}

export class VkApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "VkApiError";
  }
}

let sequence = 0;

/**
 * Calls VK API from the browser via JSONP. VK does not send CORS headers for
 * plain fetch(), so a <script> tag is the only way a static page can query it.
 */
export function vkApiCall<T>(
  method: string,
  params: Record<string, string | number | undefined>,
): Promise<T> {
  const config = getConfig();

  if (!hasToken(config)) {
    return Promise.reject(
      new VkApiError(401, "NO_TOKEN", "Токен не указан. Откройте config.js и впишите accessToken."),
    );
  }

  return new Promise<T>((resolve, reject) => {
    const callback = `__vk_${Date.now()}_${++sequence}`;
    const url = new URL(`${API_BASE}/${method}`);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    url.searchParams.set("access_token", config.accessToken!);
    url.searchParams.set("v", config.apiVersion ?? "5.199");
    url.searchParams.set("callback", callback);

    const timeoutMs = config.timeoutMs ?? 20000;
    const script = document.createElement("script");
    let settled = false;

    const cleanup = () => {
      Reflect.deleteProperty(window, callback);
      script.remove();
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new VkApiError(504, "TIMEOUT", "Нет ответа от VK в течение заданного времени"));
    }, timeoutMs);

    (window as unknown as Record<string, (data: unknown) => void>)[callback] = (data) => {
      if (settled) return;
      settled = true;
      cleanup();
      handlePayload(data, resolve, reject);
    };

    script.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new VkApiError(502, "NETWORK", "Не удалось загрузить скрипт VK API"));
    };

    script.src = url.toString();
    document.head.appendChild(script);
  });
}

function handlePayload<T>(
  data: unknown,
  resolve: (value: T) => void,
  reject: (reason: Error) => void,
): void {
  const payload = data as { response?: T; error?: VkErrorPayload };

  if (payload.error) {
    const err = payload.error;
    reject(
      new VkApiError(502, `VK_${err.error_code}`, describeVkError(err.error_code, err.error_msg)),
    );
    return;
  }
  if (payload.response === undefined) {
    reject(new VkApiError(502, "EMPTY", "VK не вернул данные"));
    return;
  }
  resolve(payload.response);
}

/** Fetches one album page directly from the VK API. */
export async function fetchPhotosPage(input: { offset: number; count: number }): Promise<PhotosPage> {
  const config = getConfig();
  const ownerId = config.ownerId;

  const response = await vkApiCall<VkPhotosResponse>("photos.get", {
    album_id: config.albumId ?? "saved",
    ...(ownerId ? { owner_id: ownerId } : {}),
    offset: input.offset,
    count: input.count,
    photo_sizes: 1,
    rev: 1,
  });

  return {
    total: response.count,
    offset: input.offset,
    count: response.items.length,
    hasMore: input.offset + response.items.length < response.count,
    items: response.items.map(mapPhoto),
  };
}

const GOOD_DISPLAY_TYPES = ["x", "y", "z", "r", "q", "p"];
const THUMB_PREFERENCE = ["m", "s", "x"];

function sizeArea(size: VkRawPhotoSize): number {
  return (size.width ?? 0) * (size.height ?? 0);
}

function bestSize(
  sizes: VkRawPhotoSize[],
  strategy: "display" | "thumb",
): VkRawPhotoSize | undefined {
  if (sizes.length === 0) return undefined;

  if (strategy === "display") {
    for (const type of GOOD_DISPLAY_TYPES) {
      const match = sizes.find((size) => size.type === type && size.url);
      if (match) return match;
    }
    const largest = [...sizes].sort((a, b) => sizeArea(b) - sizeArea(a))[0];
    return largest?.url ? largest : undefined;
  }

  for (const type of THUMB_PREFERENCE) {
    const match = sizes.find((size) => size.type === type && size.url);
    if (match) return match;
  }
  const smallest = [...sizes].sort((a, b) => sizeArea(a) - sizeArea(b))[0];
  return smallest?.url ? smallest : undefined;
}

function mapPhoto(raw: VkRawPhoto): Photo {
  const sizes = raw.sizes ?? [];
  const display = bestSize(sizes, "display");
  const thumb = bestSize(sizes, "thumb");

  return {
    id: raw.id,
    ownerId: raw.owner_id,
    albumId: raw.album_id,
    width: display?.width ?? raw.width ?? 0,
    height: display?.height ?? raw.height ?? 0,
    text: raw.text ?? "",
    date: raw.date,
    ...(thumb ? { thumbnailUrl: thumb.url } : {}),
    ...(display ? { displayUrl: display.url } : {}),
  };
}