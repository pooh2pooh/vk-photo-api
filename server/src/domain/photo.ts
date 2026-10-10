export interface PhotoSize {
  /** VK size type, e.g. "s", "m", "x", "y", "z", "o", "w". */
  type: string;
  url: string;
  width: number;
  height: number;
}

export interface Photo {
  id: number;
  ownerId: number;
  albumId: number;
  width: number;
  height: number;
  text: string;
  /** Unix timestamp (seconds). */
  date: number;
  sizes: PhotoSize[];
}

const GOOD_DISPLAY_TYPES = ["x", "y", "z", "r", "q", "p"];

/**
 * Picks the most suitable size for on-screen display: prefer large-but-not-huge
 * variants, otherwise fall back to the largest available.
 */
export function pickDisplaySize(photo: Photo): PhotoSize | undefined {
  if (photo.sizes.length === 0) return undefined;

  for (const type of GOOD_DISPLAY_TYPES) {
    const match = photo.sizes.find((size) => size.type === type);
    if (match) return match;
  }

  return [...photo.sizes].sort((a, b) => b.width * b.height - a.width * a.height)[0];
}

export function pickThumbnailSize(photo: Photo): PhotoSize | undefined {
  if (photo.sizes.length === 0) return undefined;

  const preferred = ["m", "s", "x"];
  for (const type of preferred) {
    const match = photo.sizes.find((size) => size.type === type);
    if (match) return match;
  }

  return [...photo.sizes].sort((a, b) => a.width * a.height - b.width * b.height)[0];
}
