import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Gallery } from "./components/Gallery.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <main className="app">
        <Gallery />
      </main>
    </QueryClientProvider>
  );
}
