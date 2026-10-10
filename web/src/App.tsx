import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Gallery } from "./components/Gallery.js";
import { Login } from "./components/Login.js";
import { checkSession, logout } from "./api/client.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

type Phase = "loading" | "anon" | "auth";

function useCursorProgress(active: boolean): void {
  useEffect(() => {
    if (active) {
      document.body.classList.add("cursor-progress");
      return () => document.body.classList.remove("cursor-progress");
    }
    return;
  }, [active]);
}

const SESSION_CHECK_TIMEOUT_MS = 6000;

function Shell() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [setupRequired, setSetupRequired] = useState(false);

  useCursorProgress(phase === "loading");

  // Никогда не блокируем интерфейс сетью: если session check не ответил за
  // отведённое время, показываем экран входа. Поздний ответ лишь повысит фазу.
  const startSessionCheck = (): (() => void) => {
    let active = true;
    const deadline = window.setTimeout(() => {
      if (active) setPhase("anon");
    }, SESSION_CHECK_TIMEOUT_MS);

    checkSession()
      .then((session) => {
        if (!active) return;
        setSetupRequired(Boolean(session.setupRequired));
        setPhase(session.authorized ? "auth" : "anon");
      })
      .catch(() => {
        if (active) setPhase("anon");
      })
      .finally(() => window.clearTimeout(deadline));

    return () => {
      active = false;
      window.clearTimeout(deadline);
    };
  };

  useEffect(() => startSessionCheck(), []);

  if (phase === "loading") {
    return (
      <div className="boot">
        <span className="spinner" aria-hidden="true" />
      </div>
    );
  }

  if (phase === "anon") {
    return (
      <Login
        setupRequired={setupRequired}
        onSuccess={() => {
          setPhase("auth");
        }}
      />
    );
  }

  const handleLogout = async () => {
    await logout().catch(() => undefined);
    void queryClient.clear();
    setPhase("anon");
  };

  const handleSessionExpired = () => {
    setPhase("anon");
    startSessionCheck();
  };

  return (
    <main className="app">
      <Gallery onLogout={handleLogout} onSessionExpired={handleSessionExpired} />
    </main>
  );
}

export function App() {
  // Приложение реально смонтировано — снимаем экран первичной загрузки.
  useEffect(() => {
    window.__APP_READY__ = true;
    document.body.classList.remove("shell-busy");
    document.getElementById("shell-boot")?.remove();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}