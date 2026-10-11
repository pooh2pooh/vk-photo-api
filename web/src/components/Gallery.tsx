import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, GROUP_AUTH_ERROR_CODE, fetchStackPhotos, fetchStacks } from "../api/client.js";
import type { StackGroup, StackPhotosResult, StacksResult } from "../api/types.js";
import { PAGE_SIZE_DENSE, PAGE_SIZE_NORMAL, isDenseSize } from "../api/config.js";
import { usePhotos, usePageSize } from "../hooks/usePhotos.js";
import { IconGridLarge, IconGridSmall, IconLayers, IconLogout, IconMore, IconRefresh, IconX } from "./icons.js";
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

  // «Стопки» похожих фото + просмотр одной стопки.
  const [panelOpen, setPanelOpen] = useState(false);
  const [stacks, setStacks] = useState<StacksResult | null>(null);
  const [stacksLoading, setStacksLoading] = useState(false);
  const [stacksError, setStacksError] = useState<string | null>(null);
  const [stackView, setStackView] = useState<StackPhotosResult | null>(null);
  const [stackTarget, setStackTarget] = useState<StackGroup | null>(null);
  const [stackViewLoading, setStackViewLoading] = useState(false);
  const [stackViewError, setStackViewError] = useState<string | null>(null);

  // На мобильных основные действия прячутся в меню «три точки».
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

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
    const nextSize = dense ? PAGE_SIZE_NORMAL : PAGE_SIZE_DENSE;
    // Страница сохраняется при смене вида: тот же номер, только если он есть
    // в новом разбиении (иначе — ближайшая доступная), без сброса на первую.
    const total = query.data?.total ?? 0;
    const maxPage = total > 0 ? Math.max(1, Math.ceil(total / nextSize)) : 1;
    setPageSize(nextSize);
    setPage((current) => Math.min(current, maxPage));
  };

  const loadStacks = useCallback(async (refresh = false) => {
    setStacksLoading(true);
    setStacksError(null);
    try {
      const result = await fetchStacks(refresh);
      // Фоллбэк без ИИ возвращает группы по датам/подписям даже при
      // configured:false — это не ошибка, а обычный режим «date».
      setStacks(result);
    } catch (error) {
      setStacksError(error instanceof Error ? error.message : String(error));
    } finally {
      setStacksLoading(false);
    }
  }, []);

  const toggleStacks = () => {
    const next = !panelOpen;
    setPanelOpen(next);
    if (next && stacks === null && !stacksLoading) void loadStacks();
  };

  const openStack = useCallback(async (group: StackGroup) => {
    setStackTarget(group);
    setStackViewLoading(true);
    setStackViewError(null);
    try {
      setStackView(await fetchStackPhotos(group.gid));
    } catch (error) {
      // Серверный кэш стопок мог не сохраниться или быть очищен между
      // запросами — пересобираем стопки (gid мог измениться) и пробуем снова.
      if (error instanceof ApiError && error.code === "AI_NO_STACKS") {
        try {
          const rebuilt = await fetchStacks(true);
          setStacks(rebuilt);
          const again = rebuilt.groups.find((g) => g.label === group.label) ?? rebuilt.groups.find((g) => g.gid === group.gid);
          if (again) {
            setStackTarget(again);
            setStackView(await fetchStackPhotos(again.gid));
            return;
          }
        } catch {
          // упало и на пересборке — покажем исходную ошибку
        }
      }
      setStackViewError(error instanceof Error ? error.message : String(error));
    } finally {
      setStackViewLoading(false);
    }
  }, []);

  const exitStack = () => {
    setStackView(null);
    setStackViewError(null);
  };

  return (
    <section className="gallery" data-busy={busy ? "true" : "false"}>
      <header className="gallery__header">
        <div className="gallery__heading">
          <h1>Сохранённые фото ВКонтакте</h1>
          <p className="gallery__subtitle">
            {query.data ? `Всего: ${query.data.total}` : "Загрузка…"}
            {query.data ? ` · на странице: ${pageSize}` : ""}
            {busy ? " · обновление…" : ""}
          </p>
        </div>

        <div className="gallery__actions gallery__actions--desktop">
          <button
            type="button"
            className="gallery__stacks icon-button"
            onClick={toggleStacks}
            aria-expanded={panelOpen}
            aria-label="Стопки"
            title="Стопки похожих фото"
          >
            <IconLayers />
          </button>
          <button
            type="button"
            className="gallery__density icon-button"
            onClick={toggleDense}
            aria-pressed={dense}
            aria-label={dense ? "Обычный вид" : "Обзор"}
            title={dense ? "Обычный вид: вернуть крупные превью" : `Обзор: показать по ${PAGE_SIZE_DENSE} фото с мелкими превью`}
          >
            {dense ? <IconGridLarge /> : <IconGridSmall />}
          </button>
          <button
            type="button"
            className="gallery__refresh icon-button"
            onClick={() => query.refetch()}
            disabled={busy}
            aria-label="Обновить"
            title="Обновить"
          >
            <IconRefresh />
          </button>
        </div>

        <div className="gallery__actions gallery__actions--mobile" ref={menuRef}>
          <button
            type="button"
            className="gallery__menu-trigger icon-button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Ещё"
            title="Ещё"
          >
            <IconMore />
          </button>
          {menuOpen ? (
            <div className="gallery__menu" role="menu" aria-label="Дополнительные действия">
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); toggleStacks(); }}>
                <IconLayers />
                <span>Стопки</span>
              </button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); toggleDense(); }}>
                {dense ? <IconGridLarge /> : <IconGridSmall />}
                <span>{dense ? "Обычный вид" : "Обзор"}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); query.refetch(); }} disabled={busy}>
                <IconRefresh />
                <span>Обновить</span>
              </button>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="gallery__logout icon-button"
          onClick={onLogout}
          aria-label="Выйти"
          title="Выйти"
        >
          <IconLogout />
        </button>
      </header>

      {busy ? (
        <div className="loading-bar" role="progressbar" aria-label="Загрузка">
          <span />
        </div>
      ) : null}

      {panelOpen ? (
        <section
          className="stacks"
          aria-label="Стопки похожих фото"
          data-mode={stacks?.mode ?? null}
          data-built={stacks?.built ?? null}
          data-total={stacks?.total ?? null}
        >
          <div className="stacks__head">
            <p className="stacks__title">
              <IconLayers width={16} height={16} />
              <span>Стопки похожих фото</span>
            </p>
            <div className="stacks__actions">
              <button
                type="button"
                className="icon-button"
                onClick={() => void loadStacks(true)}
                disabled={stacksLoading}
                aria-label="Пересобрать стопки"
                title="Пересобрать стопки"
              >
                <IconRefresh />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => setPanelOpen(false)}
                aria-label="Скрыть панель стопок"
                title="Скрыть"
              >
                <IconX />
              </button>
            </div>
          </div>

          {stacks?.mode === "date" ? (
            <p className="stacks__note">
              {stacks.note ?? "Стопки собраны без ИИ (по дате, подписям и размерам)"}
            </p>
          ) : null}

          {stacksLoading ? (
            <div className="stacks__loading" role="status">
              <span className="spinner" aria-hidden="true" />
              <p>Собираю стопки… первый запуск может занять до нескольких минут.</p>
            </div>
          ) : stacksError ? (
            <div className="stacks__error">
              <p className="stacks__error-text">{stacksError}</p>
              <button type="button" onClick={() => void loadStacks(true)}>
                Повторить
              </button>
            </div>
          ) : stacks && stacks.groups.length === 0 ? (
            <p className="stacks__empty">Похожих фотографий пока не нашлось.</p>
          ) : stacks ? (
            <div className="stacks__grid">
              {stacks.groups.map((group) => (
                <button
                  key={group.gid}
                  type="button"
                  className="stack-card"
                  onClick={() => void openStack(group)}
                  aria-label={`Стопка «${group.label}», ${group.count} фото`}
                >
                  <span className="stack-card__covers">
                    {group.cover.length > 0
                      ? group.cover.map((url) => <img key={url} src={url} alt="" loading="lazy" decoding="async" />)
                      : <span className="stack-card__cover-empty">—</span>}
                  </span>
                  <span className="stack-card__label">{group.label}</span>
                  <span className="stack-card__count">{group.count}</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {stackView ? (
        <div className="stack-active">
          <p className="stack-active__title">
            <IconLayers width={16} height={16} />
            <span>Стопка: {stackView.label}</span>
            <span className="stack-active__count">
              {stackView.count > stackView.items.length
                ? `${stackView.items.length} из ${stackView.count}`
                : stackView.items.length}
            </span>
          </p>
          <button type="button" className="stack-active__exit" onClick={exitStack}>
            Ко всем фото
          </button>
        </div>
      ) : null}

      {stackView || stackViewLoading ? (
        stackViewLoading ? (
          <div className={dense ? "grid grid--dense" : "grid"} aria-busy="true">
            {Array.from({ length: Math.min(pageSize, MAX_SKELETONS) }).map((_, index) => (
              <div key={index} className="photo-card photo-card--skeleton" />
            ))}
          </div>
        ) : stackViewError ? (
          <div className="state state--error">
            <p>Не удалось открыть стопку.</p>
            <p className="state__detail">{stackViewError}</p>
            {stackTarget ? (
              <button type="button" onClick={() => void openStack(stackTarget)}>
                Повторить
              </button>
            ) : null}
          </div>
        ) : (
          <div className={dense ? "grid grid--dense" : "grid"}>
            {stackView
              ? stackView.items.map((photo, index) => (
                  <PhotoCard
                    key={`${photo.ownerId}_${photo.id}`}
                    photo={photo}
                    onOpen={() => setSelectedIndex(index)}
                  />
                ))
              : null}
          </div>
        )
      ) : query.isError ? (
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

      {!stackView ? (
        <Pagination
          page={page}
          totalPages={totalPages}
          onChange={(next) => {
            setPage(next);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          disabled={query.isFetching}
        />
      ) : null}

      {(() => {
        const lightboxItems = stackView ? stackView.items : items;
        return (
          selectedIndex !== null && lightboxItems[selectedIndex] ? (
            <Lightbox
              photos={lightboxItems}
              index={selectedIndex}
              onIndexChange={setSelectedIndex}
              onClose={() => setSelectedIndex(null)}
            />
          ) : null
        );
      })()}
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
  const preview =
    error instanceof ApiError && error.details && typeof error.details === "object"
      ? (error.details as { preview?: string }).preview
      : undefined;

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
      {preview ? <pre className="state__preview">{preview}</pre> : null}
      {!isConfig && (
        <button type="button" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}