import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Для локальной разработки: PHP-сервер на http://localhost:8090, который
// проксируется на /api.php (те же относительные пути, что и в продакшене).
const PHP_TARGET = process.env.PHP_TARGET ?? "http://localhost:8090";

// Статическая сборка в корень репозитория — работает в любой поддиректории.
export default defineConfig({
  plugins: [react()],
  base: "./",
  publicDir: false,
  build: {
    outDir: "../",
    emptyOutDir: false,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api.php": {
        target: PHP_TARGET,
        changeOrigin: true,
        // не переписываем путь — api.php должен жить рядом с index.html
      },
    },
  },
});