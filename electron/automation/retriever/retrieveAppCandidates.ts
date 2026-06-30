import {
  findNativeAppById,
  resolveNativeApp,
} from "../desktop/nativeAppRegistry.js";
import { graphLookup } from "./graphLookup.js";
import type { Candidate } from "../planner/types.js";

function dedupeAppCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];

  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    const key = c.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }

  return out;
}

/**
 * P5.2 — app open chain: knowledge graph (incl. app_role) → native app registry.
 */
export function retrieveAppCandidates(phrase: string): Candidate[] {
  const spoken = phrase.trim();
  if (!spoken) return [];

  const candidates: Candidate[] = [];

  const graph = graphLookup(spoken);
  if (graph) candidates.push(graph);

  const app = resolveNativeApp(spoken);
  if (app) {
    candidates.push({
      path: app.id,
      label: app.label,
      score: 0.88,
      source: "index",
    });
  }

  const words = spoken.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  for (const word of words) {
    const byWord = resolveNativeApp(word);
    if (byWord) {
      candidates.push({
        path: byWord.id,
        label: byWord.label,
        score: 0.72,
        source: "index",
      });
    }
    const byId = findNativeAppById(word);
    if (byId) {
      candidates.push({
        path: byId.id,
        label: byId.label,
        score: 0.8,
        source: "index",
      });
    }
  }

  return dedupeAppCandidates(candidates);
}
