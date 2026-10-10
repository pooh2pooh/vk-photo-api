const PAGE_SIZE_KEY = "vkphotos_page_size";

/** Обычный режим: сколько фото на страницу по умолчанию. */
export const PAGE_SIZE_NORMAL = 30;
/**
 * Режим «Обзор»: 100 фото на страницу с мелкими превью. Укладывается ровно
 * в один запрос к VK — это заведомо в пределах частотного лимита
 * (3 запроса в секунду на user-токен, см. README).
 */
export const PAGE_SIZE_DENSE = 100;
/** Максимум, который принимает бэкенд (совпадает с VK photos.get). */
export const PAGE_SIZE_MAX = 1000;
/**
 * Размер одного сетевого запроса. Страница «Обзор» (100 фото) — ровно один
 * запрос; если страница больше, тянем порциями, чтобы каждый запрос был
 * быстрым и кэшировался, а фото появлялись по мере загрузки. Порция не
 * превышает 100 — это безопасно для частотного лимита VK.
 */
export const PAGE_CHUNK_SIZE = 100;

export function getPageSize(): number {
  try {
    const value = Number(window.localStorage.getItem(PAGE_SIZE_KEY));
    // Принимаем только известные размеры: старые значения (например, 666)
    // игнорируем, иначе страница выйдет за рамки лимита запросов.
    if (value === PAGE_SIZE_NORMAL || value === PAGE_SIZE_DENSE) return value;
  } catch {
    // localStorage недоступен — используем значение по умолчанию
  }
  return PAGE_SIZE_NORMAL;
}

export function setPageSize(value: number): void {
  try {
    window.localStorage.setItem(PAGE_SIZE_KEY, String(value));
  } catch {
    // ignore
  }
}

/** Плотный ли это режим (мелкие превью + много фото). */
export function isDenseSize(value: number): boolean {
  return value >= PAGE_SIZE_DENSE;
}
