const PAGE_SIZE_KEY = "vkphotos_page_size";

/** Обычный режим: сколько фото на страницу по умолчанию. */
export const PAGE_SIZE_NORMAL = 30;
/** Плотный режим: «всё сразу» — много фото, мелкие превью. */
export const PAGE_SIZE_DENSE = 666;
/** Максимум, который принимает бэкенд (совпадает с VK photos.get). */
export const PAGE_SIZE_MAX = 1000;

export function getPageSize(): number {
  try {
    const value = Number(window.localStorage.getItem(PAGE_SIZE_KEY));
    if (Number.isInteger(value) && value > 0 && value <= PAGE_SIZE_MAX) return value;
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
  return value > 100;
}
