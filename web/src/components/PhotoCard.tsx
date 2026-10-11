import { useState } from "react";
import type { Photo } from "../api/types.js";
import { dragPhoto } from "../dragPhoto.js";

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
      draggable
      onDragStart={(event) => dragPhoto(event, photo)}
    >
      {src && !failed ? (
        <img
          src={src}
          alt={photo.text}
          width={photo.width || undefined}
          height={photo.height || undefined}
          loading="lazy"
          decoding="async"
          draggable={false}
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