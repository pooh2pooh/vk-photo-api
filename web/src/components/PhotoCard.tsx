import type { Photo } from "../api/types.js";

interface PhotoCardProps {
  photo: Photo;
  onOpen: (photo: Photo) => void;
}

export function PhotoCard({ photo, onOpen }: PhotoCardProps) {
  const src = photo.thumbnailUrl ?? photo.displayUrl;
  const aspectRatio = photo.width && photo.height ? `${photo.width} / ${photo.height}` : "1 / 1";

  return (
    <button
      type="button"
      className="photo-card"
      style={{ aspectRatio }}
      onClick={() => onOpen(photo)}
      aria-label={photo.text || `Фото ${photo.id}`}
    >
      {src ? (
        <img src={src} alt={photo.text} loading="lazy" decoding="async" />
      ) : (
        <span className="photo-card__empty">нет превью</span>
      )}
    </button>
  );
}
