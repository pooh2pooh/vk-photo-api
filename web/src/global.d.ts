interface ShellLoader {
  version: string;
  ready: boolean;
  show(label?: string): void;
  hide(): void;
  begin(label?: string): void;
  end(label?: string): void;
  log(level: string, message: string): void;
  info(message: string): void;
  ok(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  net(message: string): void;
  clear(): void;
  restart(): void;
  report(): void;
  isReady(): boolean;
}

interface Window {
  __APP_READY__?: boolean;
  __VK_APP_MOUNTED__?: boolean;
  __VK_LOADER__?: ShellLoader;
}
