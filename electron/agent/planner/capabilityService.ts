import type { CapabilitySnapshot } from "./toolTypes.js";
import type { WorldModel } from "../types.js";
import { TOOL_MANIFEST_VERSION } from "./toolDefinitions.js";
import { listRegisteredTools } from "./toolRegistry.js";
import {
  getCachedCapabilitySnapshot,
  invalidateCapabilitySnapshotCache,
  setCachedCapabilitySnapshot,
} from "./capabilitySnapshotCache.js";
import { registerPhase1DesktopTools } from "./tools/desktopTools.js";
import { registerPhase1BrowserTools } from "./tools/browserTools.js";
import { registerPhase2FilesystemTools } from "./tools/filesystemTools.js";
import { registerPhase1SystemTools } from "./tools/systemTools.js";

function snapshotFromWorld(world?: WorldModel): CapabilitySnapshot {
  registerPhase1DesktopTools();
  registerPhase1BrowserTools();
  registerPhase2FilesystemTools();
  registerPhase1SystemTools();
  const caps = world?.capabilities;

  return {
    capturedAt: Date.now(),
    manifestVersion: TOOL_MANIFEST_VERSION,
    registeredTools: listRegisteredTools().map((t) => t.name),
    native: {
      sendInput: caps?.sendInput ?? process.platform === "win32",
      uia: caps?.uia ?? false,
      ocr: caps?.ocr ?? false,
      sidecarUp: caps?.sidecarConnected ?? false,
    },
    extensions: {
      whatsapp: world?.browser.surface === "whatsapp",
    },
    permissions: {},
  };
}

/** Probe extensions, native flags, and registered tools — cached with TTL. */
export async function getCapabilitySnapshot(
  world?: WorldModel,
): Promise<CapabilitySnapshot> {
  const hit = getCachedCapabilitySnapshot();
  if (hit && hit.manifestVersion === TOOL_MANIFEST_VERSION) {
    return hit;
  }

  const snapshot = snapshotFromWorld(world);
  setCachedCapabilitySnapshot(snapshot);
  return snapshot;
}

export function canRipple(
  capability: string,
  snapshot: CapabilitySnapshot,
): boolean {
  if (capability === "ocr") return snapshot.native.ocr;
  if (capability === "sendInput") return snapshot.native.sendInput;
  if (capability === "send_whatsapp") {
    return snapshot.extensions.whatsapp === true;
  }
  if (capability === "send_gmail") {
    return snapshot.extensions.gmail === true;
  }
  if (capability.startsWith("tool:")) {
    const name = capability.slice("tool:".length);
    return snapshot.registeredTools.includes(name);
  }
  if (capability === "desktop") {
    return snapshot.registeredTools.some((t) => t.startsWith("desktop."));
  }
  if (capability === "filesystem") {
    return snapshot.registeredTools.some((t) => t.startsWith("filesystem."));
  }
  if (capability === "clipboard") {
    return snapshot.registeredTools.some((t) => t.startsWith("system.clipboard."));
  }
  return false;
}

export function invalidateCapabilities(): void {
  invalidateCapabilitySnapshotCache();
}

export type { FrozenToolCategory } from "./toolTypes.js";
