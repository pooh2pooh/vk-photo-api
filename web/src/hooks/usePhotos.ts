import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchPhotos } from "../api/client.js";
import { getPageSize } from "../api/config.js";
import type { PhotosPage } from "../api/types.js";

const PAGE_TTL_MS = 5 * 60 * 1000;

interface CachedPage<T> {
  at: number;
  data: T;
}

function cacheKey(offset: number, count: number): string {
  return `vkphotos_page_${offset}_${count}`;
}

function readPageCache(offset: number, count: number): PhotosPage | undefined {
  try {
    const raw = window.localStorage.getItem(cacheKey(offset, count));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as CachedPage<PhotosPage>;
    if (typeof parsed.at !== "number" || Date.now() - parsed.at > PAGE_TTL_MS) return undefined;
    if (!Array.isArray(parsed.data?.items)) return undefined;
    return parsed.data;
  } catch {
    return undefined;
  }
}

function writePageCache(offset: number, count: number, data: PhotosPage): void {
  try {
    const entry: CachedPage<PhotosPage> = { at: Date.now(), data };
    window.localStorage.setItem(cacheKey(offset, count), JSON.stringify(entry));
  } catch {
    // localStorage переполнен или недоступен — кэш не критичен
  }
}

export function usePageSize(): number {
  return getPageSize();
}

export function usePhotos(page: number) {
  const count = usePageSize();
  const offset = (page - 1) * count;

  return useQuery({
    queryKey: ["photos", { offset, count }],
    queryFn: async () => {
      const data = await fetchPhotos({ offset, count });
      writePageCache(offset, count, data);
      return data;
    },
    // Свежие данные из localStorage показываются мгновенно,
    // после TTL выполняется тихое обновление.
    initialData: () => readPageCache(offset, count),
    staleTime: PAGE_TTL_MS,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}