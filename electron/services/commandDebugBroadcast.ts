import { BrowserWindow } from "electron";

export type CommandDebugEvent = {
  at: string;
  command: string;
  transcript?: string;
  intent?: string;
  tools?: string[];
  tool?: string;
  status: "SUCCESS" | "FAILED" | "CLARIFY" | "PARTIAL";
  result?: string;
  error?: string;
  source?: string;
};

export function broadcastCommandDebug(event: CommandDebugEvent): void {
  const payload = {
    ...event,
    at: event.at || new Date().toISOString(),
  };
  console.info(
    `[ripple-debug] ${payload.status} cmd="${payload.command.slice(0, 60)}" tools=${(payload.tools ?? []).join(",") || payload.tool || "-"}`,
  );
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      try {
        win.webContents.send("command:debug", payload);
      } catch {
        /* ignore */
      }
    }
  }
}

function preferFriendlyJson(text: string): string {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return text;
    }
    if (typeof parsed.summary === "string" && parsed.summary.trim()) {
      const preview =
        typeof parsed.ocrTextPreview === "string" && parsed.ocrTextPreview.trim()
          ? `\n\nOCR preview:\n${parsed.ocrTextPreview}`
          : "";
      // Code-explain payloads also use `summary` — prefer the full text.
      if (
        typeof parsed.filePath === "string" ||
        typeof parsed.fileName === "string" ||
        Array.isArray(parsed.exports)
      ) {
        return parsed.summary;
      }
      return `${parsed.summary}${preview}`;
    }
    if (typeof parsed.name === "string" && parsed.name.trim()) {
      const path =
        typeof parsed.path === "string" && parsed.path.trim()
          ? `\npath: ${parsed.path}`
          : "";
      return `${parsed.name}${path}`;
    }
    if (typeof parsed.project === "string" && parsed.project.trim()) {
      const lines = [
        "Your current workspace:",
        `Project: ${parsed.project}`,
        typeof parsed.application === "string" && parsed.application.trim()
          ? `Application: ${parsed.application}`
          : "",
        typeof parsed.openedFile === "string" && parsed.openedFile.trim()
          ? `Opened file: ${parsed.openedFile}`
          : "",
        typeof parsed.location === "string" && parsed.location.trim()
          ? `Location: ${parsed.location}`
          : "",
        typeof parsed.explanation === "string" && parsed.explanation.trim()
          ? `Status: ${parsed.explanation}`
          : "",
      ].filter(Boolean);
      return lines.join("\n");
    }
    if (parsed.status === "UNAVAILABLE" && typeof parsed.message === "string") {
      return parsed.message;
    }
    if (typeof parsed.query === "string" && parsed.found !== undefined) {
      return JSON.stringify(parsed, null, 2);
    }
  } catch {
    /* keep raw */
  }
  return text;
}

export function summarizeDebugResult(value: unknown, max = 1200): string {
  if (value == null) return "";
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const friendly = preferFriendlyJson(text.trim());
  return friendly.length > max ? `${friendly.slice(0, max)}…` : friendly;
}
