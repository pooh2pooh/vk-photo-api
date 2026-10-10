import { AppError } from "../../domain/errors.js";
import { buildPage, clamp, type Page } from "../../domain/pagination.js";
import type { Photo } from "../../domain/photo.js";
import type { VkGateway } from "../ports/VkGateway.js";

export interface GetAlbumPhotosInput {
  offset?: number;
  count?: number;
  ownerId?: number;
}

export interface GetAlbumPhotosDeps {
  vk: VkGateway;
  albumId: string;
  defaultCount: number;
  maxCount: number;
  defaultOwnerId?: number;
}

/**
 * Use-case: return one page of photos from the configured album.
 * Owns pagination validation/clamping; knows nothing about HTTP or VK wire format.
 */
export class GetAlbumPhotos {
  constructor(private readonly deps: GetAlbumPhotosDeps) {}

  async execute(input: GetAlbumPhotosInput = {}): Promise<Page<Photo>> {
    const offset = input.offset ?? 0;
    const count = input.count ?? this.deps.defaultCount;

    if (!Number.isInteger(offset) || offset < 0) {
      throw new AppError("VALIDATION_FAILED", "offset must be a non-negative integer", {
        statusCode: 400,
      });
    }
    if (!Number.isInteger(count) || count <= 0) {
      throw new AppError("VALIDATION_FAILED", "count must be a positive integer", {
        statusCode: 400,
      });
    }

    const safeCount = clamp(count, 1, this.deps.maxCount);
    const ownerId = input.ownerId ?? this.deps.defaultOwnerId;

    const page = await this.deps.vk.getAlbumPhotos({
      albumId: this.deps.albumId,
      ...(ownerId !== undefined ? { ownerId } : {}),
      offset,
      count: safeCount,
    });

    return buildPage(page.items, page.total, offset, safeCount);
  }
}
