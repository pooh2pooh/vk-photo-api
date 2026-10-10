import { useEffect } from "react";
import type { Photo } from "../api/types.js";

interface LightboxProps {
  photo: Photo;
  onClose: () => void;
}

export function Lightbox({ photo, onClose }: LightboxProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const src = photo.displayUrl ?? photo.thumbnailUrl;

  return (
    <div className="lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="lightbox__content" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="lightbox__close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        {src ? <img src={src} alt={photo.text} /> : <p>Изображение недоступно</p>}
        {photo.text ? <p className="lightbox__caption">{photo.text}</p> : null}
        <p className="lightbox__meta">
          {new Date(photo.date * 1000).toLocaleString("ru-RU")} · {photo.width}×{photo.height}
        </p>
      </div>
    </div>
  );
}
