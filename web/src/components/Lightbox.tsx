import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Photo } from "../api/types.js";

interface LightboxProps {
  photos: Photo[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

/** Мини-пауза между переключениями — чтобы колесо/стрелки не «пролистывали» пачками. */
const NAV_COOLDOWN_MS = 220;
/** Задержка перед показом спиннера — чтобы он не мигал на закэшированных фото. */
const SPINNER_DELAY_MS = 140;

export function Lightbox({ photos, index, onIndexChange, onClose }: LightboxProps) {
  const photo: Photo | undefined = photos[index];
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showSpinner, setShowSpinner] = useState(false);

  const lastNavRef = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const thumbsRef = useRef<HTMLDivElement>(null);

  // Переключение с защитой от слишком частого срабатывания.
  const go = useCallback(
    (delta: number) => {
      const stamp = performance.now();
      if (stamp - lastNavRef.current < NAV_COOLDOWN_MS) return;
      const next = index + delta;
      if (next < 0 || next >= photos.length) return;
      lastNavRef.current = stamp;
      onIndexChange(next);
    },
    [index, photos.length, onIndexChange],
  );

  // Новое фото — сбрасываем состояние загрузки.
  const photoId = photo?.id;
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    setShowSpinner(false);
    // Картинка из кэша может быть готова ещё до события load —
    // проверяем сразу, иначе спиннер «залипнет» навсегда.
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [photoId]);

  // Спиннер показываем только если картинка грузится дольше SPINNER_DELAY_MS,
  // и обязательно прячем, как только она загрузилась (или не смогла).
  useEffect(() => {
    if (loaded || failed || !photo?.displayUrl) {
      setShowSpinner(false);
      return;
    }
    const timer = window.setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [loaded, failed, photoId, photo?.displayUrl]);

  // Предзагрузка соседних фото — перелистывание становится мгновенным.
  useEffect(() => {
    for (const delta of [-1, 1]) {
      const neighbor = photos[index + delta];
      const url = neighbor?.displayUrl ?? neighbor?.thumbnailUrl;
      if (url) {
        const img = new Image();
        img.src = url;
      }
    }
  }, [photos, index]);

  // Клавиатура: Esc — закрыть, ←/→ — листать.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        go(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go, onClose]);

  // Колесо мыши: над лентой миниатюр — горизонтальная прокрутка,
  // в остальном месте — переключение фото. passive:false, чтобы отменить скролл страницы.
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (thumbsRef.current && event.target instanceof Node && thumbsRef.current.contains(event.target)) {
        return;
      }
      event.preventDefault();
      if (Math.abs(event.deltaY) < 2) return;
      go(event.deltaY > 0 ? 1 : -1);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [go]);

  // Пока открыт просмотр — не скроллим страницу под ним.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!photo) return null;
  const src = photo.displayUrl ?? photo.thumbnailUrl;

  return (
    <div className="lightbox" role="dialog" aria-modal="true" ref={rootRef} onClick={onClose}>
      <div className="lightbox__content" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="lightbox__close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>

        <button
          type="button"
          className="lightbox__nav lightbox__nav--prev"
          onClick={() => go(-1)}
          disabled={index <= 0}
          aria-label="Предыдущее фото"
        >
          ‹
        </button>
        <button
          type="button"
          className="lightbox__nav lightbox__nav--next"
          onClick={() => go(1)}
          disabled={index >= photos.length - 1}
          aria-label="Следующее фото"
        >
          ›
        </button>

        <div className="lightbox__stage">
          {src && !failed ? (
            <img
              key={photo.id}
              ref={imgRef}
              src={src}
              alt={photo.text}
              className={loaded ? "is-loaded" : undefined}
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
            />
          ) : null}
          {showSpinner && !loaded && !failed ? (
            <span className="spinner lightbox__spinner" aria-hidden="true" />
          ) : null}
          {failed || (!src && !failed) ? (
            <p className="lightbox__hint">{failed ? "Не удалось загрузить" : "Изображение недоступно"}</p>
          ) : null}
        </div>

        <div className="lightbox__info">
          {photo.text ? <p className="lightbox__caption">{photo.text}</p> : null}
          <p className="lightbox__meta">
            {new Date(photo.date * 1000).toLocaleString("ru-RU")} · {photo.width}×{photo.height} · {index + 1} /{" "}
            {photos.length}
          </p>
        </div>

        <div className="lightbox__thumbs" ref={thumbsRef}>
          {/* Вся лента рендерится одним треком и сдвигается трансформом, так что
              число элементов не меняется и активная миниатюра всегда по центру —
              лента не «дёргается». Края затухают маской (эффект бесконечности). */}
          <div className="lightbox__track" style={{ "--i": index } as CSSProperties}>
            {photos.map((item, absolute) => {
              const isActive = absolute === index;
              return (
                <button
                  key={`${item.ownerId}_${item.id}`}
                  type="button"
                  className={isActive ? "lightbox__thumb is-active" : "lightbox__thumb"}
                  onClick={() => onIndexChange(absolute)}
                  aria-label={`Фото ${absolute + 1}`}
                  aria-current={isActive ? "true" : undefined}
                >
                  <img src={item.thumbnailUrl ?? item.displayUrl} alt="" loading="lazy" decoding="async" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
