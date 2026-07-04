import { vi } from "vitest";
import { loadEnv } from "vite";

const env = loadEnv("test", process.cwd(), "");
for (const [key, value] of Object.entries(env)) {
  if (value && process.env[key] === undefined) {
    process.env[key] = value;
  }
}

/** Planner v2 is opt-in per spec (see phase-p85-planner-v2.spec.ts). */
process.env.RIPPLE_P85_PLANNER_V2 = "0";

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
