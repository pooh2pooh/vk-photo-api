import { IconChevronLeft, IconChevronRight } from "./icons.js";

interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  disabled?: boolean;
}

type Token = number | "ellipsis";

function buildTokens(page: number, totalPages: number, siblings = 1): Token[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const tokens: Token[] = [1];
  const start = Math.max(2, page - siblings);
  const end = Math.min(totalPages - 1, page + siblings);

  if (start > 2) tokens.push("ellipsis");
  for (let i = start; i <= end; i++) tokens.push(i);
  if (end < totalPages - 1) tokens.push("ellipsis");

  tokens.push(totalPages);
  return tokens;
}

export function Pagination({ page, totalPages, onChange, disabled }: PaginationProps) {
  if (totalPages <= 1) return null;

  const tokens = buildTokens(page, totalPages);
  const go = (target: number) => {
    if (!disabled && target >= 1 && target <= totalPages && target !== page) {
      onChange(target);
    }
  };

  return (
    <nav className="pagination" aria-label="Пагинация">
      <button
        type="button"
        className="icon-button"
        onClick={() => go(page - 1)}
        disabled={disabled || page <= 1}
        aria-label="Предыдущая страница"
        title="Назад"
      >
        <IconChevronLeft />
      </button>

      {tokens.map((token, index) =>
        token === "ellipsis" ? (
          <span key={`ellipsis-${index}`} className="pagination__ellipsis">
            …
          </span>
        ) : (
          <button
            type="button"
            key={token}
            className={token === page ? "pagination__page pagination__page--active" : "pagination__page"}
            onClick={() => go(token)}
            disabled={disabled}
            aria-current={token === page ? "page" : undefined}
          >
            {token}
          </button>
        ),
      )}

      <button
        type="button"
        className="icon-button"
        onClick={() => go(page + 1)}
        disabled={disabled || page >= totalPages}
        aria-label="Следующая страница"
        title="Вперёд"
      >
        <IconChevronRight />
      </button>
    </nav>
  );
}
