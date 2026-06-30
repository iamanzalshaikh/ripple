import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendActivityLog, clearActivityLog } from "./activityLog.js";
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

export type P8bSeedResult = {
  dir: string;
  ahmedPdf: string;
  sarahPdf: string;
  sarahRef: string;
  goaPdf: string;
};

/** Dev/test — seed activity + embeddings for manual voice QA. */
export function seedP8bTestData(): P8bSeedResult {
  initRippleDb();
  clearActivityLog();
  clearSemanticIndex();
  clearSemanticEmbeddings();
  clearLifeEvents();

  const dir = mkdtempSync(join(tmpdir(), "ripple-p8b-manual-"));
  const ahmedPdf = join(dir, "ahmed-quarterly-proposal.pdf");
  const sarahPdf = join(dir, "sarah-contract-draft.pdf");
  const goaPdf = join(dir, "goa-packing-checklist.pdf");
  writeFileSync(ahmedPdf, "Quarterly proposal discussed with Ahmed — budget review");
  writeFileSync(sarahPdf, "Contract draft Sarah sent for legal review");
  writeFileSync(goaPdf, "Goa trip packing list hotels flights");

  appendActivityLog({
    path: ahmedPdf,
    contact: "ahmed",
    command: "Discussed quarterly proposal with Ahmed",
    summary: "ahmed-quarterly-proposal.pdf",
  });
  upsertSemanticIndex({
    path: ahmedPdf,
    command: "PDF discussed with Ahmed quarterly proposal",
    contact: "ahmed",
    appId: "whatsapp",
  });

  ingestCrossAppReference({
    appId: "slack",
    summary: "Sarah shared contract draft for review",
    contact: "sarah",
    command: "Slack: Sarah sent contract draft",
    path: sarahPdf,
  });
  upsertSemanticRef({
    appId: "slack",
    contact: "sarah",
    summary: "Sarah shared contract draft for review",
  });

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

  console.info(`[ripple-desktop] P8b test data seeded → ${dir}`);
  return { dir, ahmedPdf, sarahPdf, sarahRef: "sarah contract slack", goaPdf };
}

export function probeP8bSearch(phrase: string): {
  embeddingPaths: string[];
  semanticRefs: string[];
} {
  return {
    embeddingPaths: searchPathEmbeddings(phrase, 5).map((x) => x.path),
    semanticRefs: searchSemanticRefs(phrase, 5).map((x) => x.summary),
  };
}
