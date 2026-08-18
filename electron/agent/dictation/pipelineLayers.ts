/**
 * Wispr-style four-layer dictation pipeline.
 *
 * Transcribe is always on (Whisper). Cleanup / format / context are separable
 * so they can be tested and toggled independently. Cleanup *levels* are
 * presets over those flags (Wispr None / Light / Medium / High).
 *
 * Does not touch insert or focus.
 */

export type CleanupLevel = "none" | "light" | "medium" | "high";

export type PipelineLayers = {
  /** Always true — STT cannot be skipped. */
  transcribe: true;
  /** Fillers, stutters, self-correction LLM. */
  cleanup: boolean;
  /** Punctuation, capitalization, spoken lists. */
  format: boolean;
  /** On-screen name bias + per-app style tone. */
  context: boolean;
};

export const PIPELINE_LAYERS_HIGH: PipelineLayers = {
  transcribe: true,
  cleanup: true,
  format: true,
  context: true,
};

export function parseCleanupLevel(value?: string | null): CleanupLevel {
  const tag = (value ?? "").trim().toLowerCase();
  if (tag === "none" || tag === "light" || tag === "medium" || tag === "high") {
    return tag;
  }
  return "high";
}

export function layersForCleanupLevel(level: CleanupLevel): PipelineLayers {
  switch (level) {
    case "none":
      return { transcribe: true, cleanup: false, format: false, context: false };
    case "light":
      return { transcribe: true, cleanup: true, format: false, context: false };
    case "medium":
      return { transcribe: true, cleanup: true, format: true, context: false };
    case "high":
    default:
      return PIPELINE_LAYERS_HIGH;
  }
}

export function cleanupLevelForLayers(
  layers: PipelineLayers,
): CleanupLevel | "custom" {
  const { cleanup, format, context } = layers;
  if (!cleanup && !format && !context) return "none";
  if (cleanup && !format && !context) return "light";
  if (cleanup && format && !context) return "medium";
  if (cleanup && format && context) return "high";
  return "custom";
}

export function parsePipelineLayers(raw?: string | null): PipelineLayers {
  const text = (raw ?? "").trim();
  if (!text) return PIPELINE_LAYERS_HIGH;
  if (text === "none" || text === "light" || text === "medium" || text === "high") {
    return layersForCleanupLevel(text);
  }
  try {
    const parsed = JSON.parse(text) as Partial<PipelineLayers>;
    return {
      transcribe: true,
      cleanup: parsed.cleanup !== false,
      format: parsed.format !== false,
      context: parsed.context !== false,
    };
  } catch {
    return PIPELINE_LAYERS_HIGH;
  }
}

export function serializePipelineLayers(layers: PipelineLayers): string {
  return JSON.stringify({
    cleanup: layers.cleanup,
    format: layers.format,
    context: layers.context,
  });
}

export async function resolvePipelineLayers(
  override?: PipelineLayers | null,
): Promise<PipelineLayers> {
  if (override) return { ...override, transcribe: true };
  if (process.env.VITEST) return PIPELINE_LAYERS_HIGH;
  try {
    const { getUserPreferences } = await import("../../storage/userPreferences.js");
    return parsePipelineLayers(getUserPreferences().pipelineLayers);
  } catch {
    return PIPELINE_LAYERS_HIGH;
  }
}
