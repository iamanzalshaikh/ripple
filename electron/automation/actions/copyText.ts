import { clipboard } from "electron";

export async function runCopyText(data?: Record<string, unknown>): Promise<string> {
  const text = typeof data?.text === "string" ? data.text : "";
  if (!text) {
    throw new Error("COPY_TEXT missing data.text");
  }
  clipboard.writeText(text);
  return `Copied ${text.length} characters to clipboard`;
}
