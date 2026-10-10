import type { PhotosPage } from "./types.js";
import { fetchPhotosPage, VkApiError, GROUP_AUTH_ERROR_CODE } from "./vkClient.js";

export interface FetchPhotosParams {
  offset: number;
  count: number;
  signal?: AbortSignal;
}

export async function fetchPhotos(params: FetchPhotosParams): Promise<PhotosPage> {
  // JSONP <script> requests cannot be aborted; honor signal best-effort.
  if (params.signal?.aborted) {
    throw new Error("aborted");
  }

  const result = await fetchPhotosPage({ offset: params.offset, count: params.count });
  if (params.signal?.aborted) throw new Error("aborted");
  return result;
}

export { VkApiError, GROUP_AUTH_ERROR_CODE };