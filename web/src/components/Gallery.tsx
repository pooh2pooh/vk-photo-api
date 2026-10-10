import { useState } from "react";
import type { Photo } from "../api/types.js";
import { VkApiError } from "../api/client.js";
import { usePhotos, usePageSize } from "../hooks/usePhotos.js";
import { Lightbox } from "./Lightbox.js";
import { Pagination } from "./Pagination.js";
import { PhotoCard } from "./PhotoCard.js";

export function Gallery() {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Photo | null>(null);
  const query = usePhotos(page);
  const pageSize = usePageSize();

  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / pageSize)) : 1;
  const isRefetching = query.isFetching && !query.isLoading;

  return (
    <section className="gallery">
      <header className="gallery__header">
        <div>
          <h1>Сохранённые фото ВКонтакте</h1>
          <p className="gallery__subtitle">
            {query.data ? `Всего: ${query.data.total}` : "Загрузка…"}
            {isRefetching ? " · обновление…" : ""}
          </p>
        </div>
        <button
          type="button"
          className="gallery__refresh"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          Обновить
        </button>
      </header>

      {query.isError ? (
        <ErrorState
          error={query.error}
          key={String(query.error)}
          onRetry={() => query.refetch()}
        />
      ) : query.isLoading ? (
        <div className="grid" aria-busy="true">
          {Array.from({ length: pageSize }).map((_, index) => (
            <div key={index} className="photo-card photo-card--skeleton" />
          ))}
        </div>
      ) : query.data && query.data.items.length === 0 ? (
        <div className="state">В альбоме нет фотографий.</div>
      ) : (
        <div className={`grid${isRefetching ? " grid--refetching" : ""}`}>
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
  const isNoToken = error instanceof VkApiError && error.code === "NO_TOKEN";
  const message = error instanceof Error ? error.message : String(error);

  return (
    <div className="state state--error">
      {isNoToken ? (
        <>
          <p>Приложение не настроено.</p>
          <p className="state__detail">
            Откройте файл <code>config.js</code> рядом с этим приложением и впишите свой
            <code> accessToken </code> (токен ВКонтакте со scope photos). После этого обновите
            страницу.
          </p>
        </>
      ) : (
        <>
          <p>Не удалось загрузить фотографии.</p>
          <p className="state__detail">{message}</p>
          <button type="button" onClick={onRetry}>
            Повторить
          </button>
        </>
      )}
    </div>
  );
}
