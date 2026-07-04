import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendActivityLog, clearActivityLog, searchCrossAppAttachmentPaths } from "./activityLog.js";
import { ingestCrossAppReference } from "./crossAppIngest.js";
import { clearLifeEvents, upsertLifeEvent } from "./lifeEvents.js";
import { clearSemanticIndex, upsertSemanticIndex } from "./semanticIndex.js";
import {
  clearSemanticEmbeddings,
  searchPathEmbeddings,
  searchSemanticRefs,
  upsertSemanticRef,
} from "./semanticEmbeddings.js";
import { initRippleDb } from "./rippleDb.js";

export const P8B_VOICE_COMMANDS = [
  "Open PDF I discussed with Ahmed",
  "Open that thing Sarah sent",
  "Open pdf before my Goa trip",
  "Open email from MongoDB Atlas",
  "Open the Naukri shortlist email",
  "Open email about job shortlist",
  "Open Gmail thread with pdf attached",
  "Open pdf Ahmed sent",
  "Open attachment from Sarah",
] as const;

export type P8bSeedResult = {
  dir: string;
  ahmedPdf: string;
  sarahPdf: string;
  goaPdf: string;
  atlasAttachment: string;
  ahmedAttachment: string;
  voiceCommands: readonly string[];
};

function writePdf(path: string, text: string): void {
  writeFileSync(path, text);
}

function attachmentDir(root: string): string {
  const dir = join(root, "downloads", "ripple", "attachments");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Dev/test — seed activity + embeddings for manual voice QA (9 scenarios). */
export function seedP8bTestData(): P8bSeedResult {
  initRippleDb();
  clearActivityLog();
  clearSemanticIndex();
  clearSemanticEmbeddings();
  clearLifeEvents();

  const dir = mkdtempSync(join(tmpdir(), "ripple-p8b-manual-"));
  const attachRoot = attachmentDir(dir);

  const ahmedPdf = join(dir, "ahmed-quarterly-proposal.pdf");
  const sarahPdf = join(dir, "sarah-contract-draft.pdf");
  const goaPdf = join(dir, "goa-packing-checklist.pdf");
  const atlasAttachment = join(attachRoot, "atlas-quarterly-report.pdf");
  const ahmedAttachment = join(attachRoot, "ahmed-invoice.pdf");

  writePdf(ahmedPdf, "Quarterly proposal discussed with Ahmed — budget review");
  writePdf(sarahPdf, "Contract draft Sarah sent for legal review");
  writePdf(goaPdf, "Goa trip packing list hotels flights");
  writePdf(atlasAttachment, "MongoDB Atlas quarterly cluster usage report PDF");
  writePdf(ahmedAttachment, "Invoice Q4 from Ahmed — payment due");

  // 1 — semantic: "Open PDF I discussed with Ahmed"
  appendActivityLog({
    path: ahmedPdf,
    contact: "ahmed",
    app_id: "whatsapp",
    command: "Discussed quarterly proposal with Ahmed",
    summary: "ahmed-quarterly-proposal.pdf",
  });
  upsertSemanticIndex({
    path: ahmedPdf,
    command: "PDF discussed with Ahmed quarterly proposal",
    contact: "ahmed",
    appId: "whatsapp",
  });

  // 2 — semantic: "Open that thing Sarah sent"
  ingestCrossAppReference({
    appId: "slack",
    summary: "Sarah shared contract draft for review",
    contact: "sarah",
    command: "Slack: Sarah sent contract draft",
    path: sarahPdf,
    attachments: ["sarah-contract-draft.pdf"],
  });
  upsertSemanticRef({
    appId: "slack",
    contact: "sarah",
    summary: "Sarah shared contract draft for review",
  });

  // 3 — life event: "Open pdf before my Goa trip"
  const tripAt = new Date("2025-03-15T12:00:00.000Z").toISOString();
  upsertLifeEvent({ label: "Goa trip", topic: "goa trip", eventAt: tripAt });
  appendActivityLog({
    path: goaPdf,
    command: "viewed goa packing pdf before trip",
    summary: "goa-packing-checklist.pdf",
  });
  upsertSemanticIndex({
    path: goaPdf,
    command: "Goa trip packing checklist before vacation",
  });

  // 4 — Gmail sender: "Open email from MongoDB Atlas"
  ingestCrossAppReference({
    appId: "gmail",
    summary: "From: MongoDB Atlas — Email: Your Atlas cluster summary",
    contact: "mongodb atlas",
    command: "Gmail: MongoDB Atlas cluster summary",
    externalUrl:
      "https://mail.google.com/mail/u/0/#search/from%3Amongodb%2Batlas",
  });

  // 5 — Gmail subject: "Open the Naukri shortlist email"
  ingestCrossAppReference({
    appId: "gmail",
    summary: "From: Naukri Campus — Email: Your job shortlist is ready",
    contact: "naukri campus",
    command: "Gmail: Naukri job shortlist",
    externalUrl: "https://mail.google.com/mail/u/0/#inbox/naukri-shortlist-seed",
  });

  // 6 — Gmail subject variant: "Open email about job shortlist"
  upsertSemanticRef({
    appId: "gmail",
    contact: "naukri campus",
    summary: "Naukri Campus job shortlist email — campus hiring list",
    refKey: "https://mail.google.com/mail/u/0/#search/subject%3Ashortlist|naukri",
  });

  // 7 — Gmail attachment + local file: "Open Gmail thread with pdf attached"
  ingestCrossAppReference({
    appId: "gmail",
    summary:
      "From: MongoDB Atlas — Email: Quarterly report — Attachments: atlas-quarterly-report.pdf",
    contact: "mongodb atlas",
    command: "Gmail attachment: atlas-quarterly-report.pdf",
    path: atlasAttachment,
    externalUrl:
      "https://mail.google.com/mail/u/0/#inbox/atlas-report-thread-seed",
    attachments: ["atlas-quarterly-report.pdf"],
  });

  // 8 — cross-app attachment: "Open pdf Ahmed sent"
  ingestCrossAppReference({
    appId: "gmail",
    summary: "From: Ahmed — Email: Invoice Q4 — Attachments: ahmed-invoice.pdf",
    contact: "ahmed",
    command: "Gmail attachment: ahmed-invoice.pdf",
    path: ahmedAttachment,
    externalUrl: "https://mail.google.com/mail/u/0/#inbox/ahmed-invoice-seed",
    attachments: ["ahmed-invoice.pdf"],
  });

  // 9 — attachment by contact: "Open attachment from Sarah"
  ingestCrossAppReference({
    appId: "gmail",
    summary: "From: Sarah — Email: Signed contract — Attachments: sarah-contract-draft.pdf",
    contact: "sarah",
    command: "Gmail attachment: sarah-contract-draft.pdf",
    path: sarahPdf,
    externalUrl: "https://mail.google.com/mail/u/0/#inbox/sarah-contract-seed",
    attachments: ["sarah-contract-draft.pdf"],
  });

  // Bonus refs — Outlook + Teams (browser ingest simulation; no dedicated voice yet)
  ingestCrossAppReference({
    appId: "outlook",
    summary: "From: HR Team — Email: Benefits enrollment deadline",
    contact: "hr team",
    command: "Outlook: benefits enrollment",
    externalUrl: "https://outlook.live.com/mail/0/inbox/hr-benefits-seed",
  });
  ingestCrossAppReference({
    appId: "teams",
    summary: "Priya shared sprint retro notes in Teams chat",
    contact: "priya",
    command: "Teams: sprint retro notes",
    externalUrl: "https://teams.microsoft.com/l/chat/seed-priya",
    attachments: ["sprint-retro-notes.docx"],
  });

  console.info(`[ripple-desktop] P8b test data seeded → ${dir}`);
  console.info(
    `[ripple-desktop] P8b seed — ${P8B_VOICE_COMMANDS.length} voice commands ready`,
  );

  return {
    dir,
    ahmedPdf,
    sarahPdf,
    goaPdf,
    atlasAttachment,
    ahmedAttachment,
    voiceCommands: P8B_VOICE_COMMANDS,
  };
}

export function probeP8bSearch(phrase: string): {
  embeddingPaths: string[];
  semanticRefs: string[];
  attachmentPaths: string[];
} {
  return {
    embeddingPaths: searchPathEmbeddings(phrase, 5).map((x) => x.path),
    semanticRefs: searchSemanticRefs(phrase, 5).map((x) => x.summary),
    attachmentPaths: searchCrossAppAttachmentPaths(phrase, { limit: 5 }),
  };
}
