import type { AlbumPhotosPage, GetPhotosParams, VkGateway } from "../../application/ports/VkGateway.js";
import type { Photo, PhotoSize } from "../../domain/photo.js";
import type { VkHttpClient } from "./VkHttpClient.js";

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

interface VkPhotosGetResponse {
  count: number;
  items: VkRawPhoto[];
}

function mapSize(raw: VkRawPhotoSize): PhotoSize | undefined {
  if (!raw.url || !raw.type) return undefined;
  return {
    type: raw.type,
    url: raw.url,
    width: raw.width ?? 0,
    height: raw.height ?? 0,
  };
}

function mapPhoto(raw: VkRawPhoto): Photo {
  const sizes = (raw.sizes ?? [])
    .map(mapSize)
    .filter((size): size is PhotoSize => size !== undefined);

  return {
    id: raw.id,
    ownerId: raw.owner_id,
    albumId: raw.album_id,
    width: raw.width ?? 0,
    height: raw.height ?? 0,
    text: raw.text ?? "",
    date: raw.date,
    sizes,
  };
}

/** Adapts the VK transport to the application `VkGateway` port. */
export class VkPhotoGateway implements VkGateway {
  constructor(private readonly client: VkHttpClient) {}

  async getAlbumPhotos(params: GetPhotosParams): Promise<AlbumPhotosPage> {
    const response = await this.client.call<VkPhotosGetResponse>("photos.get", {
      album_id: params.albumId,
      owner_id: params.ownerId,
      offset: params.offset,
      count: params.count,
      photo_sizes: 1,
      rev: 1,
    });

    return {
      total: response.count,
      items: (response.items ?? []).map(mapPhoto),
    };
  }
}
