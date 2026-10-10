import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

// Защита от двойного монтирования: если основной бандл и резервная копия
// загрузятся оба, повторный запуск не должен создавать второе приложение.
if (!window.__VK_APP_MOUNTED__) {
  window.__VK_APP_MOUNTED__ = true;

  const container = document.getElementById("root");
  if (!container) throw new Error("Root container #root not found");

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // Сигнал отказоустойчивому загрузчику: приложение поднялось.
  function signalReady() {
    window.__APP_READY__ = true;
    document.body.classList.remove("shell-busy");
    document.getElementById("shell-boot")?.remove();
  }

  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(signalReady);
  } else {
    window.setTimeout(signalReady, 0);
  }
}