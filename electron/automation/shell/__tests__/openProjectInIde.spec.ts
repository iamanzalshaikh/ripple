import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { EventEmitter } from "node:events";

const spawnMock = vi.fn();
const focusPreferMock = vi.fn(async () => "focused");
const focusMock = vi.fn(async () => "focused");
const isShowingMock = vi.fn(async () => false);

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (...args: unknown[]) => spawnMock(...args),
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
  };
});

vi.mock("../../desktop/resolveLaunchTarget.js", () => ({
  resolveLaunchTarget: () =>
    "C:\\Users\\ANZAL\\AppData\\Local\\Programs\\cursor\\Cursor.exe",
}));

vi.mock("../../desktop/windowManager.js", () => ({
  focusAppWindow: (...args: unknown[]) => focusMock(...args),
  focusAppWindowPreferringTitle: (...args: unknown[]) =>
    focusPreferMock(...args),
  isAppWindowShowingTitle: (...args: unknown[]) => isShowingMock(...args),
}));

vi.mock("../delay.js", () => ({
  delay: vi.fn(async () => {}),
}));

describe("openProjectInIde / openFileAtLineInIde", () => {
  beforeEach(() => {
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        unref: () => void;
      };
      child.unref = () => {};
      setImmediate(() => child.emit("spawn"));
      return child;
    });
    vi.mocked(existsSync).mockReturnValue(true);
    isShowingMock.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens project with --new-window when not already open", async () => {
    const { openProjectInIde } = await import("../projectResolver.js");
    const folder = "C:\\Users\\ANZAL\\Desktop\\jkf ( funiture )";

    await openProjectInIde(folder, {
      id: "cursor",
      aliases: ["cursor"],
      launch: "cursor",
      processNames: ["cursor"],
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [exe, args, opts] = spawnMock.mock.calls[0]!;
    expect(exe).toContain("Cursor.exe");
    expect(args).toEqual(["--new-window", folder]);
    expect(opts).toMatchObject({ shell: false, detached: true });
    expect(focusPreferMock).toHaveBeenCalled();
  });

  it("skips relaunch when project window already open", async () => {
    isShowingMock.mockResolvedValue(true);
    const { openProjectInIde } = await import("../projectResolver.js");
    const folder = "C:\\Users\\ANZAL\\Desktop\\jkf ( funiture )";

    const msg = await openProjectInIde(folder, {
      id: "cursor",
      aliases: ["cursor"],
      launch: "cursor",
      processNames: ["cursor"],
    });

    expect(spawnMock).not.toHaveBeenCalled();
    expect(msg).toMatch(/Focused existing/);
    expect(focusPreferMock).toHaveBeenCalled();
  });

  it("throws when the folder does not exist", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const { openProjectInIde } = await import("../projectResolver.js");

    await expect(
      openProjectInIde("C:\\missing\\folder", {
        id: "cursor",
        aliases: ["cursor"],
        launch: "cursor",
        processNames: ["cursor"],
      }),
    ).rejects.toThrow(/project_not_found/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("opens file at line with --reuse-window --goto", async () => {
    const { openFileAtLineInIde } = await import("../projectResolver.js");
    const file =
      "C:\\Users\\ANZAL\\Desktop\\jkf ( funiture )\\src\\lib\\project-content.ts";

    await openFileAtLineInIde(file, 69, {
      id: "cursor",
      aliases: ["cursor"],
      launch: "cursor",
      processNames: ["cursor"],
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, args] = spawnMock.mock.calls[0]!;
    expect(args).toEqual([
      "--reuse-window",
      "--goto",
      `${file}:69:1`,
    ]);
    expect(focusPreferMock).toHaveBeenCalled();
  });
});
