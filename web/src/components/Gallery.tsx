import { useEffect, useState } from "react";
import type { Photo } from "../api/types.js";
import { ApiError, GROUP_AUTH_ERROR_CODE } from "../api/client.js";
import { usePhotos, usePageSize } from "../hooks/usePhotos.js";
import { Lightbox } from "./Lightbox.js";
import { Pagination } from "./Pagination.js";
import { PhotoCard } from "./PhotoCard.js";

interface GalleryProps {
  onLogout: () => void;
  onSessionExpired: () => void;
}

export function Gallery({ onLogout, onSessionExpired }: GalleryProps) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Photo | null>(null);
  const query = usePhotos(page);
  const pageSize = usePageSize();

  const busy = query.isFetching;
  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / pageSize)) : 1;

  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401) {
      onSessionExpired();
    }
  }, [query.error, onSessionExpired]);

  useEffect(() => {
    document.body.classList.toggle("cursor-progress", busy);
    return () => document.body.classList.remove("cursor-progress");
  }, [busy]);

  return (
    <section className="gallery" data-busy={busy ? "true" : "false"}>
      <header className="gallery__header">
        <div>
          <h1>Сохранённые фото ВКонтакте</h1>
          <p className="gallery__subtitle">
            {query.data ? `Всего: ${query.data.total}` : "Загрузка…"}
            {busy ? " · обновление…" : ""}
          </p>
        </div>
        <button type="button" className="gallery__refresh" onClick={() => query.refetch()} disabled={busy}>
          Обновить
        </button>
        <button type="button" className="gallery__logout" onClick={onLogout}>
          Выйти
        </button>
      </header>

      {busy ? (
        <div className="loading-bar" role="progressbar" aria-label="Загрузка">
          <span />
        </div>
      ) : null}

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.isLoading ? (
        <div className="grid" aria-busy="true">
          {Array.from({ length: pageSize }).map((_, index) => (
            <div key={index} className="photo-card photo-card--skeleton" />
          ))}
        </div>
      ) : query.data && query.data.items.length === 0 ? (
        <div className="state">В альбоме нет фотографий.</div>
      ) : (
        <div className="grid">
          {query.data?.items.map((photo) => (
            <PhotoCard key={`${photo.ownerId}_${photo.id}`} photo={photo} onOpen={setSelected} />
          ))}
        </div>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        onChange={(next) => {
          setPage(next);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        disabled={query.isFetching}
      />

      {selected ? <Lightbox photo={selected} onClose={() => setSelected(null)} /> : null}
    </section>
  );
}

interface ErrorStateProps {
  error: unknown;
  onRetry: () => void;
}

function ErrorState({ error, onRetry }: ErrorStateProps) {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof ApiError ? error.code : "";
  const isGroupToken = code === GROUP_AUTH_ERROR_CODE;
  const isConfig = code === "NETWORK" || code === "VK_NOT_CONFIGURED";

  if (isGroupToken) {
    return (
      <div className="state state--error">
        <p>На сервере используется токен сообщества (group auth).</p>
        <p className="state__detail">
          Альбом «Сохранённые фото» доступен только через персональный user-токен. Обновите{" "}
          <code>private/secrets.php</code> на сервере:
        </p>
        <ol className="state__steps">
          <li>
            Создайте <em>standalone</em>-приложение (https://vk.com/editapp?act=create).
          </li>
          <li>
            Получите user-токен со scope <code>photos,offline</code> (URL авторизации — в README).
          </li>
          <li>Впишите токен в <code>private/secrets.php</code> → <code>vk_token</code>.</li>
        </ol>
      </div>
    );
  }

  return (
    <div className="state state--error">
      <p>Не удалось загрузить фотографии.</p>
      <p className="state__detail">{message}</p>
      {!isConfig && (
        <button type="button" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}