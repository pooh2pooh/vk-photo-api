export interface VkConfig {
  accessToken?: string;
  apiVersion?: string;
  albumId?: string;
  ownerId?: string | number | null;
  pageSize?: number;
  timeoutMs?: number;
}

declare global {
  interface Window {
    VK_CONFIG?: VkConfig;
  }
}

export const API_BASE = "https://api.vk.com/method";

const DEFAULT_CONFIG: Required<Pick<VkConfig, "apiVersion" | "albumId" | "pageSize" | "timeoutMs">> = {
  apiVersion: "5.199",
  albumId: "saved",
  pageSize: 30,
  timeoutMs: 20000,
};

export function getConfig(): VkConfig {
  return { ...DEFAULT_CONFIG, ...DEFAULT_CONFIG_FROM_WINDOW() };
}

function DEFAULT_CONFIG_FROM_WINDOW(): VkConfig {
  return window.VK_CONFIG ?? {};
}

export function getOwnerId(config: VkConfig): number | undefined {
  const raw = config.ownerId;
  if (raw === undefined || raw === null || raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function hasToken(config: VkConfig): config is VkConfig & { accessToken: string } {
  return Boolean(config.accessToken && config.accessToken.trim().length > 0);
}