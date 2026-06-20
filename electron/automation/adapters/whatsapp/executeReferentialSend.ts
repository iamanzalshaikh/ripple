import { basename } from "node:path";
import { existsSync, statSync } from "node:fs";
import { prepareWhatsAppAttachment } from "./whatsappAttachment.js";
import { runWhatsAppLocalBatch } from "../../actions/local/runLocalAction.js";
import {
  getLastCommandContext,
  rememberContact,
} from "../../../storage/lastCommandState.js";
import type { ReferentialSendIntent } from "../../voice/nlu/parseReferentialWhatsApp.js";

function itemKindLabel(path: string): "file" | "folder" | "pdf" | "photo" | "video" {
  if (!existsSync(path)) return "file";
  if (statSync(path).isDirectory()) return "folder";
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (/^(png|jpe?g|gif|webp|heic)$/i.test(ext)) return "photo";
  if (/^(mp4|mov|mkv|webm|avi)$/i.test(ext)) return "video";
  return "file";
}

export function buildReferentialSendMessage(path: string): string {
  const name = basename(path);
  const kind = itemKindLabel(path);
  const labels: Record<string, string> = {
    folder: "folder",
    pdf: "PDF",
    photo: "photo",
    video: "screen recording",
    file: "file",
  };
  const label = labels[kind] ?? "file";
  return `Here is the ${label}: ${name} (${path})`;
}

export type ReferentialSendOptions = {
  /** Explicit disk path from a prior compound step — overrides session memory. */
  sourcePath?: string;
};

/** Run WhatsApp send using session last_file / last_folder + named contact. */
export async function executeReferentialSend(
  intent: ReferentialSendIntent,
  command = "",
  options?: ReferentialSendOptions,
): Promise<string> {
  const contact = intent.contact.trim();
  if (!contact) {
    throw new Error('Say who to send to, e.g. "Send it to Noor"');
  }

  rememberContact(contact);

  if (intent.mode === "message_again") {
    return runWhatsAppLocalBatch({
      text: "",
      recipient: contact,
      send: false,
      command,
      _whatsappBatch: true,
    });
  }

  const ctx = getLastCommandContext();
  const targetPath =
    options?.sourcePath?.trim() || ctx.last_file || ctx.last_folder;
  if (!targetPath) {
    throw new Error(
      'Nothing recent to send — open a file or folder first, then say e.g. "Send to Dr. Fatima"',
    );
  }

  const message = buildReferentialSendMessage(targetPath);
  const kind = itemKindLabel(targetPath);
  const attachment = prepareWhatsAppAttachment(targetPath);
  const outboundText = attachment ? "" : message;
  console.info(
    `[ripple-desktop] sending ${kind} "${basename(targetPath)}" from ${targetPath} → WhatsApp contact "${contact}"${attachment ? " (file attach)" : " (text only)"}`,
  );

  const result = await runWhatsAppLocalBatch({
    text: outboundText,
    recipient: contact,
    send: true,
    command: options?.sourcePath ? "" : command,
    sourcePath: targetPath,
    sourceKind: kind,
    attachment: attachment ?? undefined,
    _whatsappBatch: true,
  });

  return result || `Sent ${kind} "${basename(targetPath)}" from ${targetPath} to ${contact}`;
}
