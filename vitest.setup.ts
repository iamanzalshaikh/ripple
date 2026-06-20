import { vi } from "vitest";
import { loadEnv } from "vite";

const env = loadEnv("test", process.cwd(), "");
for (const [key, value] of Object.entries(env)) {
  if (value && process.env[key] === undefined) {
    process.env[key] = value;
  }
}

vi.mock("electron", () => ({
  app: {
    getPath: () => "C:\\Users\\Test\\AppData",
    getName: () => "ripple-test",
  },
  shell: {
    openPath: vi.fn(async () => ""),
    openExternal: vi.fn(async () => undefined),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  globalShortcut: {
    register: vi.fn(() => true),
    unregisterAll: vi.fn(),
  },
  BrowserWindow: vi.fn(),
}));
