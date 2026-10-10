import type { Photo } from "../../domain/photo.js";

export interface GetPhotosParams {
  /** Target album ("saved" for the personal profile Saved photos). */
  albumId: string;
  /** Omit to use the token owner. */
  ownerId?: number;
  offset: number;
  count: number;
}

export interface AlbumPhotosPage {
  items: Photo[];
  total: number;
}

/**
 * Port describing every VK capability the application layer needs.
 * Implemented by the infrastructure VK adapter; use-cases depend only on this.
 */
export interface VkGateway {
  getAlbumPhotos(params: GetPhotosParams): Promise<AlbumPhotosPage>;
}
