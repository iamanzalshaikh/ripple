import { describe, expect, it } from "vitest";
import {
  MATRIX_STATS,
  PRODUCTION_E2E_MATRIX,
} from "./e2e-matrix.data.js";
import { runProductionPipeline } from "./e2e-pipeline.harness.js";
import { resolveMultilingualCommand } from "./multilingualPlanner.harness.js";
import { useFreshNluCache } from "./testHelpers.js";

useFreshNluCache();

describe("Production E2E — matrix coverage (Phases 3.5–4.7)", () => {
  it(`runs ${MATRIX_STATS.total}+ user slang / tone variants`, () => {
    expect(MATRIX_STATS.total).toBeGreaterThanOrEqual(300);
    expect(Object.keys(MATRIX_STATS.byPhase).length).toBeGreaterThanOrEqual(5);
  });

  it.each(PRODUCTION_E2E_MATRIX.map((c) => [c.id, c] as const))(
    "[%s] %s",
    (_id, spec) => {
      if (spec.route === "desktop") {
        const resolved = resolveMultilingualCommand(spec.phrase, spec.kind);
        expect(resolved.route).toBe("desktop");
        expect(spec.phrase.length).toBeGreaterThan(0);
        if (spec.kind) {
          expect(resolved.kind).toBe(spec.kind);
        }
        return;
      }

      const result = runProductionPipeline(spec.phrase);

      expect(result.transcript.length).toBeGreaterThan(0);
      expect(result.nlu.length).toBeGreaterThan(0);

      expect(result.route).toBe(spec.route);

      if (spec.kind) {
        expect(result.kind).toBe(spec.kind);
      } else if (spec.route === "none") {
        expect(result.kind).toBeNull();
      }

      if (spec.route === "whatsapp") {
        expect(result.whatsappWorkflow).toBe(true);
      }

      if (spec.route === "youtube") {
        expect(result.youtubeWorkflow).toBe(true);
      }
    },
  );
});

describe("Production E2E — no token-merge regressions across matrix", () => {
  const folderPhrases = PRODUCTION_E2E_MATRIX.filter((c) =>
    c.tags?.includes("folder"),
  ).map((c) => c.phrase);

  it.each(folderPhrases.slice(0, 30))(
    'no glued tokens in "%s"',
    (phrase) => {
      const { nlu } = runProductionPipeline(phrase);
      expect(nlu.toLowerCase()).not.toMatch(
        /downloadsopen|documentsopen|desktopopen|downloadskaro/,
      );
    },
  );
});

describe("Production E2E — routing isolation", () => {
  it("desktop folder never routes to whatsapp", () => {
    const r = runProductionPipeline("Bhai download kholo");
    expect(r.route).toBe("desktop");
    expect(r.whatsappWorkflow).toBe(false);
  });

  it("whatsapp message never routes to desktop folder", () => {
    const r = runProductionPipeline("Message Noor hello");
    expect(r.route).toBe("whatsapp");
    expect(r.kind).not.toBe("folder");
  });

  it("AI chit-chat stays off desktop", () => {
    const r = runProductionPipeline("Tell me a joke");
    expect(r.route).toBe("none");
    expect(r.desktopBlocked).toBe(false);
  });
});
