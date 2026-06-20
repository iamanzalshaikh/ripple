import { describe, expect, it } from "vitest";
import {
  getNativeCapabilities,
  isNativeHostReady,
} from "../nativeHost.js";
import { isWin32NativeAvailable } from "../win32Bridge.js";
import {
  listRegisteredHotkeys,
  registerNativeHotkeys,
  unregisterNativeHotkeys,
} from "../hotkeyRegistry.js";

describe("P7 native layer", () => {
  it("reports platform capabilities", () => {
    const caps = getNativeCapabilities();
    expect(caps.platform).toBe(process.platform);
    expect(caps.win32Bridge).toBe(isWin32NativeAvailable());
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
    expect(caps.sendInput).toBe(isWin32NativeAvailable());
  });
});
