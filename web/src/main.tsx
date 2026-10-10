import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root container #root not found");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Сигнал отказоустойчивому загрузчику: приложение поднялось.
window.requestAnimationFrame(() => {
  window.__APP_READY__ = true;
  document.body.classList.remove("shell-busy");
  document.getElementById("shell-boot")?.remove();
});
