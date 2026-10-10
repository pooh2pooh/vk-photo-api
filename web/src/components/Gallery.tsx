import { useState } from "react";
import type { Photo } from "../api/types.js";
import { PAGE_SIZE, usePhotos } from "../hooks/usePhotos.js";
import { Lightbox } from "./Lightbox.js";
import { Pagination } from "./Pagination.js";
import { PhotoCard } from "./PhotoCard.js";

export function Gallery() {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Photo | null>(null);
  const query = usePhotos(page);

  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / PAGE_SIZE)) : 1;
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
        <div className="state state--error">
          <p>Не удалось загрузить фотографии.</p>
          <p className="state__detail">{(query.error as Error).message}</p>
          <button type="button" onClick={() => query.refetch()}>
            Повторить
          </button>
        </div>
      ) : query.isLoading ? (
        <div className="grid" aria-busy="true">
          {Array.from({ length: PAGE_SIZE }).map((_, index) => (
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
