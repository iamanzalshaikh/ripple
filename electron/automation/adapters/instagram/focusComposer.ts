import {
  focusInstagramComposerViaExtension,
  isExtensionBridgeConnected,
} from "../../../bridge/whatsappExtensionBridge.js";

/** Click the open Instagram DM composer via extension (best-effort). */
export async function focusInstagramComposer(): Promise<void> {
  if (!isExtensionBridgeConnected()) return;
  try {
    await focusInstagramComposerViaExtension();
  } catch {
    /* desktop paste may still work if user already clicked the box */
  }
}
