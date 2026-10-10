import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { AppError } from "../../domain/errors.js";
import { registerHealthRoutes, type HealthDeps } from "./routes/health.js";
import { registerPhotoRoutes, type PhotoRoutesDeps } from "./routes/photos.js";

export interface BuildServerOptions {
  logger?: boolean;
  photoRoutes: PhotoRoutesDeps;
  health: HealthDeps;
  corsOrigin?: string | boolean;
}

function serializeError(error: unknown): { statusCode: number; body: Record<string, unknown> } {
  if (AppError.isAppError(error)) {
    return {
      statusCode: error.statusCode,
      body: { error: { code: error.code, message: error.message, details: error.details } },
    };
  }
  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      body: { error: { code: "VALIDATION_FAILED", message: "Invalid request" } },
    };
  }
  return {
    statusCode: 500,
    body: { error: { code: "INTERNAL", message: "Internal server error" } },
  };
}

/** Composition of the HTTP presentation layer. No business logic lives here. */
export function buildServer(options: BuildServerOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? true,
    disableRequestLogging: false,
  });

  app.register(cors, { origin: options.corsOrigin ?? true });

  app.setErrorHandler((error, request, reply) => {
    const { statusCode, body } = serializeError(error);
    if (statusCode >= 500) {
      request.log.error({ err: error }, "request failed");
    } else {
      request.log.warn({ err: error, code: body.error }, "request rejected");
    }
    reply.status(statusCode).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: { code: "NOT_FOUND", message: `Route ${request.method} ${request.url} not found` },
    });
  });

  registerHealthRoutes(app, options.health);
  registerPhotoRoutes(app, options.photoRoutes);

  return app;
}
