import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Статическая сборка, которую можно положить в любую поддиректорию
// любого веб-сервера (Apache/nginx) и открыть сразу.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    // Сборка пишется в корень репозитория: index.html, assets/, config.js.
    // Тогда при копировании папки проекта в /var/www/html/<поддиректория>
    // приложение доступно по /<поддиректория>/ без настройки сервера.
    outDir: "../",
    emptyOutDir: false,
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});