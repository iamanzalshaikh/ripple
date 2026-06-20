import { beforeEach } from "vitest";
import { clearPreprocessCache } from "../preprocess.js";

/** Reset NLU cache between cases — mirrors per-command orchestrator behavior. */
export function useFreshNluCache(): void {
  beforeEach(() => {
    clearPreprocessCache();
  });
}
