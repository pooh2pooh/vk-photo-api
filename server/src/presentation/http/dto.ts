import { pickDisplaySize, pickThumbnailSize, type Photo } from "../../domain/photo.js";

export interface PhotoDto {
  id: number;
  ownerId: number;
  albumId: number;
  width: number;
  height: number;
  text: string;
  date: number;
  thumbnailUrl?: string;
  displayUrl?: string;
}

/**
 * Presentation mapping: turns a domain photo into a transport-friendly shape
 * with concrete image URLs, so clients never need VK size semantics.
 */
export function toPhotoDto(photo: Photo): PhotoDto {
  const display = pickDisplaySize(photo);
  const thumbnail = pickThumbnailSize(photo);

  return {
    id: photo.id,
    ownerId: photo.ownerId,
    albumId: photo.albumId,
    width: display?.width ?? photo.width,
    height: display?.height ?? photo.height,
    text: photo.text,
    date: photo.date,
    ...(thumbnail ? { thumbnailUrl: thumbnail.url } : {}),
    ...(display ? { displayUrl: display.url } : {}),
  };
}
