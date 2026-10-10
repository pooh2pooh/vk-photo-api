import { useState } from "react";
import type { Photo } from "../api/types.js";

interface PhotoCardProps {
  photo: Photo;
  onOpen: (photo: Photo) => void;
}

export function PhotoCard({ photo, onOpen }: PhotoCardProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const src = photo.thumbnailUrl ?? photo.displayUrl;
  const ratio = photo.width && photo.height ? photo.width / photo.height : 1;

  return (
    <button
      type="button"
      className="photo-card"
      style={{ flexGrow: ratio }}
      onClick={() => onOpen(photo)}
      aria-label={photo.text || `Фото ${photo.id}`}
    >
      {src && !failed ? (
        <img
          src={src}
          alt={photo.text}
          loading="lazy"
          decoding="async"
          className={loaded ? "is-loaded" : undefined}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="photo-card__empty">нет превью</span>
      )}
    </button>
  );
}