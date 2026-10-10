import { GetAlbumPhotos } from "./application/usecases/GetAlbumPhotos.js";
import { loadEnv } from "./config/env.js";
import { AppError } from "./domain/errors.js";
import { VkHttpClient } from "./infrastructure/vk/VkHttpClient.js";
import { VkPhotoGateway } from "./infrastructure/vk/VkPhotoGateway.js";
import { buildServer } from "./presentation/http/server.js";

async function main(): Promise<void> {
  const env = loadEnv();

  const vkClient = new VkHttpClient({
    token: env.VK_TOKEN,
    apiVersion: env.VK_API_VERSION,
    timeoutMs: env.VK_TIMEOUT_MS,
    retryAttempts: env.VK_RETRY_ATTEMPTS,
  });

  const vkGateway = new VkPhotoGateway(vkClient);

  const getAlbumPhotos = new GetAlbumPhotos({
    vk: vkGateway,
    albumId: env.VK_ALBUM_ID,
    defaultCount: env.defaultPageSize,
    maxCount: env.maxPageSize,
    ...(env.VK_OWNER_ID !== undefined ? { defaultOwnerId: env.VK_OWNER_ID } : {}),
  });

  const app = buildServer({
    logger: true,
    photoRoutes: { getAlbumPhotos },
    health: { albumId: env.VK_ALBUM_ID },
  });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down");
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, "error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
  } catch (error) {
    app.log.error({ err: error }, "failed to start server");
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  const message = AppError.isAppError(error)
    ? `${error.code}: ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error);
  console.error(`Fatal startup error -> ${message}`);
  process.exit(1);
});
