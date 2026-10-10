#!/usr/bin/env bash
# Генерация полного набора иконок из web/icons/icon.svg.
# Требуется: rsvg-convert (librsvg) и ImageMagick (magick/convert).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/web/icons/icon.svg"

if [ ! -f "$src" ]; then
  echo "make-icons: не найден $src" >&2
  exit 1
fi

if command -v rsvg-convert >/dev/null 2>&1; then
  raster() { rsvg-convert -w "$1" -h "$1" "$src" -o "$2"; }
else
  raster() { magick -background none -density 1024 "$src" -resize "${1}x${1}" "$2"; }
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for s in 16 32 48 64 180 192 512; do
  raster "$s" "$tmp/$s.png"
done

# favicon.ico (16/32/48)
if command -v magick >/dev/null 2>&1; then
  magick "$tmp/16.png" "$tmp/32.png" "$tmp/48.png" "$root/favicon.ico"
else
  convert "$tmp/16.png" "$tmp/32.png" "$tmp/48.png" "$root/favicon.ico"
fi

# Файлы в корень (рядом с index.html)
cp "$src" "$root/icon.svg"
cp "$tmp/180.png" "$root/apple-touch-icon.png"
cp "$tmp/192.png" "$root/android-chrome-192x192.png"
cp "$tmp/512.png" "$root/android-chrome-512x512.png"
cp "$tmp/192.png" "$root/icon-192.png"
cp "$tmp/512.png" "$root/icon-512.png"

cat > "$root/site.webmanifest" <<'JSON'
{
  "name": "Фото ВК — сохранённые",
  "short_name": "Фото ВК",
  "description": "Просмотр альбома «Сохранённые фото» ВКонтакте",
  "lang": "ru",
  "dir": "ltr",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#0f1115",
  "theme_color": "#0f1115",
  "icons": [
    { "src": "./icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" },
    { "src": "./android-chrome-192x192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "./android-chrome-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "./android-chrome-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
JSON

echo "make-icons: готово (favicon.ico, icon.svg, apple-touch-icon.png, android-chrome-*.png, site.webmanifest)"
