import { applyFileTagging } from "./fileTagging.js";
import { applyVariableRecognition } from "./variableRecognition.js";

export type DevModeTextResult = {
  text: string;
  fileTags: string[];
  variableReplacements: Array<{ from: string; to: string }>;
};

function devModeEnabled(): boolean {
  const flag = (process.env.RIPPLE_DEV_MODE ?? "1").trim().toLowerCase();
  return flag !== "0" && flag !== "false" && flag !== "off";
}

function fileTaggingEnabled(): boolean {
  const flag = (process.env.RIPPLE_FILE_TAGGING ?? "1").trim().toLowerCase();
  return devModeEnabled() && flag !== "0" && flag !== "false" && flag !== "off";
}

function variableRecognitionEnabled(): boolean {
  const flag = (process.env.RIPPLE_VARIABLE_RECOGNITION ?? "1")
    .trim()
    .toLowerCase();
  return devModeEnabled() && flag !== "0" && flag !== "false" && flag !== "off";
}

/**
 * Wispr Dev Mode — post-cleanup text transforms for IDE dictation.
 * Runs after rewrite; never touches insert, focus, or overlay.
 */
export async function applyDevModeText(
  text: string,
  options?: { processName?: string | null },
): Promise<DevModeTextResult> {
  if (!text.trim() || !devModeEnabled()) {
    return { text, fileTags: [], variableReplacements: [] };
  }

  let out = text;
  const fileTags: string[] = [];
  const variableReplacements: Array<{ from: string; to: string }> = [];

  if (fileTaggingEnabled()) {
    const tagged = applyFileTagging(out, options?.processName);
    out = tagged.text;
    fileTags.push(...tagged.tags);
  }

  if (variableRecognitionEnabled()) {
    const vars = applyVariableRecognition(out, options?.processName);
    out = vars.text;
    variableReplacements.push(...vars.replacements);
  }

  if (fileTags.length || variableReplacements.length) {
    console.info(
      `[ripple-dev-mode] surface=dictation tags=${fileTags.length} ` +
        `vars=${variableReplacements.length} process=${options?.processName ?? "?"}`,
    );
  }

  return { text: out, fileTags, variableReplacements };
}
