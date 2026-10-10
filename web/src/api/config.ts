const PAGE_SIZE_KEY = "vkphotos_page_size";

export function getPageSize(): number {
  try {
    const value = Number(window.localStorage.getItem(PAGE_SIZE_KEY));
    if (Number.isInteger(value) && value > 0 && value <= 100) return value;
  } catch {
    // localStorage недоступен — используем значение по умолчанию
  }
  return 30;
}

export function setPageSize(value: number): void {
  try {
    window.localStorage.setItem(PAGE_SIZE_KEY, String(value));
  } catch {
    // ignore
  }
}