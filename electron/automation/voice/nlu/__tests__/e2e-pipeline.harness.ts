/**
 * Production E2E harness — mirrors Mic → Whisper → normalize → route → intent.
 */
import { buildWhatsAppCommandResult } from "../../../adapters/whatsapp/whatsappCommand.js";
import { buildYouTubeCommandResult } from "../../../adapters/youtube/youtubeCommand.js";
import { normalizeTranscript } from "../../normalizeTranscript.js";
import { isLikelyDesktopCommand } from "../desktopIntentGuard.js";
import { parseDesktopIntent } from "../pipeline.js";
import { preprocessForNlu } from "../preprocess.js";

export type E2ERoute = "desktop" | "whatsapp" | "youtube" | "none";

export type PipelineResult = {
  transcript: string;
  nlu: string;
  route: E2ERoute;
  kind: string | null;
  desktopBlocked: boolean;
  whatsappWorkflow: boolean;
  youtubeWorkflow: boolean;
};

export function runProductionPipeline(raw: string): PipelineResult {
  const transcript = normalizeTranscript(raw);
  const { nlu } = preprocessForNlu(transcript);
  const routed = nlu.trim() || transcript;

  const wa =
    buildWhatsAppCommandResult(transcript) ??
    buildWhatsAppCommandResult(routed);
  if (wa?.actions?.length) {
    return {
      transcript,
      nlu,
      route: "whatsapp",
      kind: wa.intent ?? "workflow",
      desktopBlocked: false,
      whatsappWorkflow: true,
      youtubeWorkflow: false,
    };
  }

  const desktop = parseDesktopIntent(transcript) ?? parseDesktopIntent(routed);
  if (desktop) {
    return {
      transcript,
      nlu,
      route: "desktop",
      kind: desktop.intent.kind,
      desktopBlocked: isLikelyDesktopCommand(transcript),
      whatsappWorkflow: false,
      youtubeWorkflow: false,
    };
  }

  const yt =
    buildYouTubeCommandResult(transcript) ??
    buildYouTubeCommandResult(routed);
  if (yt?.actions?.length) {
    return {
      transcript,
      nlu,
      route: "youtube",
      kind: yt.intent ?? "workflow",
      desktopBlocked: false,
      whatsappWorkflow: false,
      youtubeWorkflow: true,
    };
  }

  return {
    transcript,
    nlu,
    route: "none",
    kind: null,
    desktopBlocked: isLikelyDesktopCommand(transcript),
    whatsappWorkflow: false,
    youtubeWorkflow: false,
  };
}
