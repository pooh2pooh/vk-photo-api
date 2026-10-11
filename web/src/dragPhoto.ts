import type { DragEvent } from "react";
import type { Photo } from "./api/types.js";

/**
 * Готовит перетаскивание фото наружу (в папку ОС, мессенджер и т.п.).
 * По умолчанию браузер тянет миниатюру (маленькое превью) — подменяем данные
 * на полный кадр: `DownloadURL` даёт сохранить файл под понятным именем, а
 * `text/uri-list` — взять ссылку.
 */
export function dragPhoto(event: DragEvent<HTMLElement>, photo: Photo): void {
  const url = photo.displayUrl ?? photo.thumbnailUrl;
  if (!url) return;

  const name = `vk-${photo.ownerId}-${photo.id}.jpg`;
  const data = event.dataTransfer;
  data.effectAllowed = "copy";
  data.setData("text/uri-list", url);
  data.setData("text/plain", url);
  try {
    // Поддерживается Chromium; используется для «перетащить в папку = сохранить».
    data.setData("DownloadURL", `image/jpeg:${name}:${url}`);
  } catch {
    // Другие браузеры обойдутся uri-list/text.
  }
}
