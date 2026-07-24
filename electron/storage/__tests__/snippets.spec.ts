import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
const runMock = vi.fn();
const allMock = vi.fn(() => []);

vi.mock("../rippleDb.js", () => ({
  getRippleDb: () => ({
    prepare: (sql: string) => {
      if (sql.includes("COUNT(*)")) {
        return {
          get: () => ({ n: store.size }),
        };
      }
      if (sql.includes("SELECT expansion")) {
        return {
          get: (key: string) => {
            const expansion = store.get(key);
            return expansion ? { expansion } : undefined;
          },
        };
      }
      if (sql.includes("SELECT created_at")) {
        return {
          get: (key: string) =>
            store.has(key) ? { created_at: "t0" } : undefined,
        };
      }
      if (sql.includes("INSERT INTO snippets")) {
        return {
          run: (
            trigger: string,
            expansion: string,
            _created: string,
            _updated: string,
          ) => {
            store.set(trigger, expansion);
          },
        };
      }
      if (sql.includes("DELETE FROM snippets")) {
        return {
          run: (key: string) => {
            const ok = store.delete(key);
            return { changes: ok ? 1 : 0 };
          },
        };
      }
      if (sql.includes("FROM snippets") && sql.includes("ORDER BY")) {
        return {
          all: () =>
            [...store.entries()].map(([trigger, expansion]) => ({
              trigger,
              expansion,
              created_at: "t0",
              updated_at: "t1",
            })),
        };
      }
      return { get: getMock, run: runMock, all: allMock };
    },
  }),
}));

const store = new Map<string, string>();

describe("snippets (P7.2)", () => {
  beforeEach(() => {
    store.clear();
  });

  it("learns and resolves exact trigger case-insensitively", async () => {
    const {
      learnSnippet,
      resolveSnippetTrigger,
    } = await import("../snippets.js");
    learnSnippet({
      trigger: "sig",
      expansion: "Best regards, Anzal",
    });
    expect(resolveSnippetTrigger("SIG")).toBe("Best regards, Anzal");
    expect(resolveSnippetTrigger("sig")).toBe("Best regards, Anzal");
  });

  it("matches trailing punctuation from STT/cleanup (sig.)", async () => {
    const {
      learnSnippet,
      resolveSnippetTrigger,
    } = await import("../snippets.js");
    learnSnippet({ trigger: "sig", expansion: "Best regards, Anzal" });
    expect(resolveSnippetTrigger("sig.")).toBe("Best regards, Anzal");
    expect(resolveSnippetTrigger("SIG!")).toBe("Best regards, Anzal");
  });

  it("matches leading filler (Ah, intro)", async () => {
    const {
      learnSnippet,
      resolveSnippetTrigger,
    } = await import("../snippets.js");
    learnSnippet({
      trigger: "intro",
      expansion: "Hi, I am Anzal from Ripple.",
    });
    expect(resolveSnippetTrigger("Ah, intro")).toBe(
      "Hi, I am Anzal from Ripple.",
    );
    expect(resolveSnippetTrigger("um intro")).toBe(
      "Hi, I am Anzal from Ripple.",
    );
  });

  it("does not expand when utterance is the expansion prose", async () => {
    const {
      learnSnippet,
      resolveSnippetTrigger,
    } = await import("../snippets.js");
    learnSnippet({
      trigger: "sig",
      expansion: "Best regards, Anzal",
    });
    expect(resolveSnippetTrigger("Best regards, Anzal")).toBeNull();
  });

  it("rewriteDictationBuffer expands snippet and skips cleanup", async () => {
    const { learnSnippet } = await import("../snippets.js");
    learnSnippet({ trigger: "addr", expansion: "42 MG Road, Bangalore." });
    const { rewriteDictationBuffer } = await import(
      "../../agent/dictation/dictationRewrite.js"
    );
    const out = await rewriteDictationBuffer({ bufferText: "addr" });
    expect(out.finalText).toBe("42 MG Road, Bangalore.");
    expect(out.kind).toBe("snippet");
    expect(out.decisionLog.reason).toBe("snippet_expansion");
    expect(out.decisionLog.modelUsed).toBe("snippet");
  });
});
