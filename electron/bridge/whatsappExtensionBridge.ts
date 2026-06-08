/**
 * WhatsApp browser bridge — Native Messaging (production) with optional WebSocket fallback.
 */
import {
  isNativeMessagingConnected,
  runYouTubeViaNativeMessaging,
  runWhatsAppViaNativeMessaging,
  startNativeMessagingBridge,
} from "./nativeMessagingBridge.js";

export type { ExtensionResult } from "./nativeMessagingBridge.js";

const USE_WS_FALLBACK = process.env.RIPPLE_USE_WS_BRIDGE === "1";

let wsBridgeStarted = false;

export function startWhatsAppExtensionBridge(): void {
  startNativeMessagingBridge();

  if (USE_WS_FALLBACK) {
    import("./whatsappWebSocketBridge.js").then((m) => {
      m.startWebSocketBridge();
      wsBridgeStarted = true;
    });
  }
}

export function isExtensionBridgeConnected(): boolean {
  if (isNativeMessagingConnected()) return true;
  if (USE_WS_FALLBACK && wsBridgeStarted) {
    return false;
  }
  return false;
}

export async function isExtensionBridgeConnectedAsync(): Promise<boolean> {
  if (isNativeMessagingConnected()) return true;
  if (USE_WS_FALLBACK) {
    const m = await import("./whatsappWebSocketBridge.js");
    return m.isWebSocketBridgeConnected();
  }
  return false;
}

export function runWhatsAppViaExtension(args: {
  contact: string;
  text: string;
  send: boolean;
}): Promise<string> {
  if (isNativeMessagingConnected()) {
    return runWhatsAppViaNativeMessaging(args);
  }

  if (USE_WS_FALLBACK) {
    return import("./whatsappWebSocketBridge.js").then((m) => {
      if (!m.isWebSocketBridgeConnected()) {
        throw new Error(m.WS_NOT_CONNECTED);
      }
      return m.runWhatsAppViaWebSocket(args);
    });
  }

  return Promise.reject(
    new Error(
      "Ripple Native Messaging not connected. See WHATSAPP_SETUP.md (extension + install-windows.ps1).",
    ),
  );
}

export function runYouTubeViaExtension(args: { query: string }): Promise<string> {
  if (isNativeMessagingConnected()) {
    return runYouTubeViaNativeMessaging(args);
  }
  return Promise.reject(
    new Error(
      "Ripple Native Messaging not connected. See WHATSAPP_SETUP.md (extension + install-windows.ps1).",
    ),
  );
}

export function runLinkedInViaExtension(args: {
  text: string;
  publish: boolean;
  pasteOnly?: boolean;
}): Promise<string> {
  if (isNativeMessagingConnected()) {
    return import("./nativeMessagingBridge.js").then((m) =>
      m.runLinkedInViaNativeMessaging(args),
    );
  }
  return Promise.reject(
    new Error(
      "Ripple Native Messaging not connected. See WHATSAPP_SETUP.md (extension + install-windows.ps1).",
    ),
  );
}

export function runInstagramViaExtension(args: {
  username: string;
  text: string;
  send: boolean;
  pasteOnly?: boolean;
  sendOnly?: boolean;
  navigateOnly?: boolean;
  focusComposer?: boolean;
}): Promise<string> {
  if (isNativeMessagingConnected()) {
    return import("./nativeMessagingBridge.js").then((m) =>
      m.runInstagramViaNativeMessaging(args),
    );
  }
  return Promise.reject(
    new Error(
      "Ripple Native Messaging not connected. See WHATSAPP_SETUP.md (extension + install-windows.ps1).",
    ),
  );
}

export function focusInstagramComposerViaExtension(): Promise<string> {
  if (isNativeMessagingConnected()) {
    return import("./nativeMessagingBridge.js").then((m) =>
      m.focusInstagramComposerViaExtension(),
    );
  }
  return Promise.reject(
    new Error(
      "Ripple Native Messaging not connected. See WHATSAPP_SETUP.md (extension + install-windows.ps1).",
    ),
  );
}

export function stopWhatsAppExtensionBridge(): void {
  import("./nativeMessagingBridge.js").then((m) => m.stopNativeMessagingBridge());
}
