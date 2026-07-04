import { describe, expect, it } from "vitest";
import {
  getNativeCapabilities,
  isNativeHostReady,
  shutdownNativeHost,
} from "../nativeHost.js";
import { isWin32NativeAvailable } from "../win32Bridge.js";
import {
  listRegisteredHotkeys,
  registerNativeHotkeys,
  unregisterNativeHotkeys,
} from "../hotkeyRegistry.js";
import { resolveNativeExePath } from "../nativeSpawn.js";
import { getBundledNativeExePath } from "../nativePaths.js";

describe("P7 native layer", () => {
  it("reports platform capabilities", () => {
    const caps = getNativeCapabilities();
    expect(caps.platform).toBe(process.platform);
    expect(caps.win32Bridge).toBe(
      isWin32NativeAvailable() || caps.sidecarConnected === true,
    );
    expect(caps.globalHotkeys).toBe(true);
  });

  it("registers voice hotkeys without throw", () => {
    unregisterNativeHotkeys();
    const result = registerNativeHotkeys([
      { accelerator: "F24", label: "test", action: "voice" },
    ]);
    expect(result.registered.length + result.failed.length).toBe(1);
    unregisterNativeHotkeys();
    expect(listRegisteredHotkeys()).toHaveLength(0);
  });

  it("native host marks ready after init", async () => {
    const { initNativeHost } = await import("../nativeHost.js");
    const caps = await initNativeHost();
    expect(isNativeHostReady()).toBe(true);
    expect(typeof caps.sidecarConnected).toBe("boolean");
    shutdownNativeHost();
  });

  it("resolveNativeExePath returns null or string", () => {
    const path = resolveNativeExePath();
    expect(path === null || path.endsWith("ripple-native.exe")).toBe(true);
  });

  it("getBundledNativeExePath returns null or packaged path", () => {
    const path = getBundledNativeExePath();
    expect(
      path === null || path.includes("native\\win32\\ripple-native.exe"),
    ).toBe(true);
  });
});
