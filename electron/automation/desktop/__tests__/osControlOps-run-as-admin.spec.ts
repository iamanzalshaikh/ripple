import { describe, expect, it, vi, beforeEach } from "vitest";

const execFileMock = vi.fn(
  (
    _file: string,
    _args: string[],
    _opts: unknown,
    callback: (error: unknown, stdout: string, stderr: string) => void,
  ) => {
    callback(null, "", "");
  },
);

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => {
    const callback = args[args.length - 1] as (
      error: unknown,
      stdout: string,
      stderr: string,
    ) => void;
    execFileMock(args[0], args[1], args[2], callback);
  },
}));

/**
 * W0 — "Run notepad as administrator" / "Open terminal as administrator"
 * both failed live with admin_target_not_found even though routing (W0.1)
 * was correct. Root cause: resolveLaunchTarget returns bare exe names
 * ("notepad.exe", "wt.exe") which existsSync can't verify — notepad.exe
 * lives in System32 (resolvable), wt.exe only resolves via an app execution
 * alias PATH stub (not resolvable via existsSync at all).
 */
describe("P8.5-P5.6 W0 — runAppAsAdmin resolves built-in Windows apps", () => {
  beforeEach(() => {
    execFileMock.mockClear();
  });

  it("resolves 'notepad' to a real System32 path and uses -FilePath", async () => {
    const { runAppAsAdmin } = await import("../osControlOps.js");
    const result = await runAppAsAdmin("notepad");

    expect(result).toContain("notepad.exe");
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const psArgs = execFileMock.mock.calls[0]?.[1] as string[];
    const psCommand = psArgs[psArgs.length - 1];
    // Start-Process has no -LiteralPath parameter at all (confirmed via
    // `Get-Command Start-Process -Syntax`) — using it always failed live.
    expect(psCommand).toContain("-FilePath");
    expect(psCommand).not.toContain("-LiteralPath");
    expect(psCommand).toMatch(/System32.*notepad\.exe/i);
  });

  it("does not throw admin_target_not_found for 'Terminal' (wt.exe, PATH-alias only) and uses -FilePath", async () => {
    const { runAppAsAdmin } = await import("../osControlOps.js");
    const result = await runAppAsAdmin("Terminal");

    expect(result).toContain("wt.exe");
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const psArgs = execFileMock.mock.calls[0]?.[1] as string[];
    const psCommand = psArgs[psArgs.length - 1];
    expect(psCommand).toContain("-FilePath");
    expect(psCommand).not.toContain("-LiteralPath");
  });

  it("still rejects a genuinely unknown app with a real path-shaped target", async () => {
    const { runAppAsAdmin } = await import("../osControlOps.js");
    await expect(
      runAppAsAdmin("C:\\definitely\\not\\a\\real\\path.exe"),
    ).rejects.toThrow(/admin_target_not_found/);
  });

  /**
   * Real live bug (not caught by the "Terminal" test above): in the actual
   * running app, Start Menu app discovery (appDiscovery.ts) registers a
   * "terminal" entry ahead of the static wt.exe one, whose launch target is
   * "shell:AppsFolder\<AUMID>" — a UWP/MSIX shell reference, not a real
   * filesystem path. It contains backslashes, so it used to trip the
   * looksLikePath heuristic and fail existsSync (which a shell: URI will
   * never pass), throwing admin_target_not_found even though
   * `Start-Process -FilePath 'shell:AppsFolder\...' -Verb RunAs` launches it
   * correctly (confirmed directly against real PowerShell).
   */
  it("does not throw admin_target_not_found for a shell:AppsFolder UWP target", async () => {
    const { runAppAsAdmin } = await import("../osControlOps.js");
    const shellTarget =
      "shell:AppsFolder\\Microsoft.WindowsTerminal_8wekyb3d8bbwe!App";
    const result = await runAppAsAdmin(shellTarget);

    expect(result).toContain(shellTarget);
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const psArgs = execFileMock.mock.calls[0]?.[1] as string[];
    const psCommand = psArgs[psArgs.length - 1];
    expect(psCommand).toContain("-FilePath");
    expect(psCommand).toContain("shell:AppsFolder");
  });
});
