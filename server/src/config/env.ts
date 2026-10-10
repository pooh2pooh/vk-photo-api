import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import { AppError } from "../domain/errors.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "..", "..", "..");

loadDotenv({
  path: [
    path.resolve(process.cwd(), ".env"),
    path.resolve(repoRoot, ".env"),
    path.resolve(repoRoot, ".env.local"),
  ],
});

const optionalInt = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === "" ? fallback : Number(value)))
    .pipe(z.number().int());

const schema = z.object({
  VK_TOKEN: z.string().min(1, "VK_TOKEN is required"),
  VK_API_VERSION: z.string().default("5.199"),
  VK_ALBUM_ID: z.string().default("saved"),
  VK_OWNER_ID: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === "" ? undefined : Number(value)))
    .pipe(z.number().int().optional()),
  PORT: optionalInt(3001),
  VK_TIMEOUT_MS: optionalInt(10_000),
  VK_RETRY_ATTEMPTS: optionalInt(3),
});

export type Env = z.infer<typeof schema> & {
  defaultPageSize: number;
  maxPageSize: number;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new AppError("CONFIG_INVALID", `Invalid environment configuration:\n${issues.join("\n")}`, {
      statusCode: 500,
    });
  }

  return {
    ...parsed.data,
    defaultPageSize: 30,
    maxPageSize: 100,
  };
}
