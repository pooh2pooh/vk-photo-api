import type { FastifyInstance } from "fastify";

export interface HealthDeps {
  albumId: string;
}

export function registerHealthRoutes(app: FastifyInstance, deps: HealthDeps): void {
  app.get("/api/health", async () => ({
    status: "ok",
    albumId: deps.albumId,
    uptimeSeconds: Math.round(process.uptime()),
  }));
}
