import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
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

function Shell() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [setupRequired, setSetupRequired] = useState(false);

  useCursorProgress(phase === "loading");

  const { data: session, isError, refetch } = useQuery({
    queryKey: ["session"],
    queryFn: checkSession,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (session) {
      setSetupRequired(Boolean(session.setupRequired));
      setPhase(session.authorized ? "auth" : "anon");
    } else if (isError) {
      setPhase("anon");
    }
  }, [session, isError]);

  if (phase === "loading") {
    return (
      <div className="boot">
        <div className="boot__spinner">
          <span className="spinner" aria-hidden="true" />
        </div>
        <p className="boot__text">Загружаем…</p>
      </div>
    );
  }

  if (phase === "anon") {
    return (
      <Login
        setupRequired={setupRequired}
        onSuccess={() => {
          setPhase("auth");
          void queryClient.invalidateQueries({ queryKey: ["session"] });
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
    void refetch();
    setPhase("anon");
  };

  return (
    <main className="app">
      <Gallery onLogout={handleLogout} onSessionExpired={handleSessionExpired} />
    </main>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}