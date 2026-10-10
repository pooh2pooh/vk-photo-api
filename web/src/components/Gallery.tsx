import { useEffect, useState } from "react";
import { ApiError, GROUP_AUTH_ERROR_CODE } from "../api/client.js";
import { PAGE_SIZE_DENSE, PAGE_SIZE_NORMAL, isDenseSize } from "../api/config.js";
import { usePhotos, usePageSize } from "../hooks/usePhotos.js";
import { Lightbox } from "./Lightbox.js";
import { Pagination } from "./Pagination.js";
import { PhotoCard } from "./PhotoCard.js";

interface GalleryProps {
  onLogout: () => void;
  onSessionExpired: () => void;
}

const MAX_SKELETONS = 60;

export function Gallery({ onLogout, onSessionExpired }: GalleryProps) {
  const [page, setPage] = useState(1);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [pageSize, setPageSize] = usePageSize();
  const query = usePhotos(page, pageSize);

  const items = query.data?.items ?? [];
  const dense = isDenseSize(pageSize);
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

  const toggleDense = () => {
    setPageSize(dense ? PAGE_SIZE_NORMAL : PAGE_SIZE_DENSE);
    setPage(1);
  };

  return (
    <section className="gallery" data-busy={busy ? "true" : "false"}>
      <header className="gallery__header">
        <div>
          <h1>Сохранённые фото ВКонтакте</h1>
          <p className="gallery__subtitle">
            {query.data ? `Всего: ${query.data.total}` : "Загрузка…"}
            {query.data ? ` · на странице: ${pageSize}` : ""}
            {busy ? " · обновление…" : ""}
          </p>
        </div>
        <button
          type="button"
          className="gallery__density"
          onClick={toggleDense}
          aria-pressed={dense}
          title={dense ? "Вернуть крупные превью" : `Обзор: показать по ${PAGE_SIZE_DENSE} фото с мелкими превью`}
        >
          {dense ? "Обычный вид" : "Обзор"}
        </button>
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
        <div className={dense ? "grid grid--dense" : "grid"} aria-busy="true">
          {Array.from({ length: Math.min(pageSize, MAX_SKELETONS) }).map((_, index) => (
            <div key={index} className="photo-card photo-card--skeleton" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="state">В альбоме нет фотографий.</div>
      ) : (
        <div className={dense ? "grid grid--dense" : "grid"}>
          {items.map((photo, index) => (
            <PhotoCard
              key={`${photo.ownerId}_${photo.id}`}
              photo={photo}
              onOpen={() => setSelectedIndex(index)}
            />
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

      {selectedIndex !== null && items[selectedIndex] ? (
        <Lightbox
          photos={items}
          index={selectedIndex}
          onIndexChange={setSelectedIndex}
          onClose={() => setSelectedIndex(null)}
        />
      ) : null}
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