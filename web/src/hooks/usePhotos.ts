import { useCallback, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchPhotos } from "../api/client.js";
import { PAGE_CHUNK_SIZE, getPageSize, setPageSize } from "../api/config.js";
import type { Photo, PhotosPage } from "../api/types.js";

const PAGE_TTL_MS = 5 * 60 * 1000;

interface CachedPage<T> {
  at: number;
  data: T;
}

interface ChunkSpec {
  offset: number;
  count: number;
}

function cacheKey(offset: number, count: number): string {
  return `vkphotos_page_${offset}_${count}`;
}

/** Страница должна содержать массив items и числовой total. */
function isValidPage(page: unknown): page is PhotosPage {
  if (!page || typeof page !== "object") return false;
  const candidate = page as Partial<PhotosPage>;
  return Array.isArray(candidate.items) && typeof candidate.total === "number";
}

function readPageCache(offset: number, count: number): PhotosPage | undefined {
  try {
    const raw = window.localStorage.getItem(cacheKey(offset, count));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as CachedPage<PhotosPage>;
    if (typeof parsed.at !== "number" || Date.now() - parsed.at > PAGE_TTL_MS) return undefined;
    if (!isValidPage(parsed.data)) return undefined;
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

/** Режем запрошенную страницу на порции не больше PAGE_CHUNK_SIZE. */
function chunkSpecs(offset: number, count: number): ChunkSpec[] {
  const specs: ChunkSpec[] = [];
  for (let done = 0; done < count; done += PAGE_CHUNK_SIZE) {
    specs.push({ offset: offset + done, count: Math.min(PAGE_CHUNK_SIZE, count - done) });
  }
  return specs;
}

/** Склеиваем страницу, только если все её порции уже в кэше. */
function readFullCache(specs: ChunkSpec[]): PhotosPage | undefined {
  const items: Photo[] = [];
  let total = 0;
  for (const spec of specs) {
    const cached = readPageCache(spec.offset, spec.count);
    if (!cached) return undefined;
    total = cached.total;
    items.push(...cached.items);
  }
  const first = specs[0] ?? { offset: 0, count: 0 };
  return { total, offset: first.offset, count: items.length, hasMore: items.length < total, items };
}

function buildPage(specs: ChunkSpec[], items: Photo[], total: number): PhotosPage {
  const first = specs[0] ?? { offset: 0, count: 0 };
  return { total, offset: first.offset, count: items.length, hasMore: items.length < total, items };
}

/**
 * Загружаем порции по очереди, отдавая промежуточный результат через onPartial:
 * пользователь видит фото по мере поступления. Если падает не первая порция —
 * не роняем галерею, а показываем то, что успели загрузить.
 */
async function loadChunks(
  specs: ChunkSpec[],
  onPartial: (page: PhotosPage) => void,
): Promise<PhotosPage> {
  const items: Photo[] = [];
  const pageOffset = specs[0]?.offset ?? 0;
  let total = 0;

  for (const spec of specs) {
    let page = readPageCache(spec.offset, spec.count);
    if (!page) {
      try {
        const fetched = await fetchPhotos(spec);
        if (!isValidPage(fetched)) throw new Error("Сервер вернул некорректный ответ");
        page = fetched;
      } catch (error) {
        if (items.length === 0) throw error;
        break; // показываем уже загруженное, не теряем всю страницу
      }
      writePageCache(spec.offset, spec.count, page);
    }
    total = page.total;
    items.push(...page.items);
    onPartial(buildPage(specs, items, total));

    // Альбом кончился: сервер вернул меньше, чем просили, или уже всё собрали.
    if (page.items.length < spec.count) break;
    if (total > 0 && items.length >= total - pageOffset) break;
  }

  return buildPage(specs, items, total);
}

export function usePageSize(): [number, (value: number) => void] {
  const [size, setSize] = useState<number>(() => getPageSize());
  const update = useCallback((value: number) => {
    setSize(value);
    setPageSize(value);
  }, []);
  return [size, update];
}

export function usePhotos(page: number, count: number) {
  const offset = (page - 1) * count;
  const specs = chunkSpecs(offset, count);
  const queryKey: [string, { offset: number; count: number }] = ["photos", { offset, count }];

  return useQuery({
    queryKey,
    queryFn: (context) => loadChunks(specs, (partial) => context.client.setQueryData(queryKey, partial)),
    // Мгновенный показ на повторных заходах, только если закэширована вся страница.
    initialData: () => readFullCache(specs),
    staleTime: PAGE_TTL_MS,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}
