import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../../../domain/errors.js";
import type { GetAlbumPhotos } from "../../../application/usecases/GetAlbumPhotos.js";
import { toPhotoDto } from "../dto.js";

const querySchema = z.object({
  offset: z.coerce.number().int().min(0).optional(),
  count: z.coerce.number().int().positive().optional(),
});

export interface PhotoRoutesDeps {
  getAlbumPhotos: GetAlbumPhotos;
}

export function registerPhotoRoutes(app: FastifyInstance, deps: PhotoRoutesDeps): void {
  app.get("/api/photos", async (request) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError("VALIDATION_FAILED", "Invalid query parameters", {
        statusCode: 400,
        details: { issues: parsed.error.issues.map((issue) => issue.message) },
      });
    }

    const page = await deps.getAlbumPhotos.execute(parsed.data);

    return {
      total: page.total,
      offset: page.offset,
      count: page.count,
      hasMore: page.hasMore,
      items: page.items.map(toPhotoDto),
    };
  });
}
