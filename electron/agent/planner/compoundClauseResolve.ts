import type { NativeCommandIntent } from "../../automation/desktop/parseNativeCommand.js";
import { parseNativeCommandStrict } from "../../automation/desktop/parseNativeCommand.js";
import { parseBrowserWorkspaceSearch } from "../../automation/browser/parseBrowserWorkspaceSearch.js";
import { parseSaveFileCommand } from "../../automation/desktop/parseSaveFileCommand.js";
import { parseCreateFileInAppCommand } from "../../automation/desktop/parseCreateFileInAppCommand.js";
import {
  desktopInputToTypeIntent,
  parseCalculatorInput,
  parseDesktopInputFallback,
} from "../parseDesktopInput.js";

/** Shared per-clause normalizer for compound planner + v2 classifier. */
export function normalizeCompoundPart(part: string): string {
  let p = part.trim();
  if (/^(?:type|write|put|say|likho|likh)\b/i.test(p)) return p;
  if (/^save\b/i.test(p) || /^store\s+as\b/i.test(p)) return p;
  if (/^(?:draw|sketch|paint|erase|fill|click|scroll|drag|select|move|press)\b/i.test(p)) {
    return p;
  }
  if (/^(?:switch|focus|go)\s+to\b/i.test(p)) return p;
  if (/^search\b/i.test(p)) return p;
  if (/^(?:downloads?|documents?|desktop)$/i.test(p)) return `open ${p}`;
  if (/^my\s+\w/i.test(p) && !/^open\b/i.test(p)) return `open ${p}`;
  if (!/^open\b/i.test(p) && /^[A-Z]/.test(p)) return p;
  return p;
}

/** Shared per-clause resolver for compound planner + gate (single source of truth). */
export function parseSimpleCompoundPartForGate(
  part: string,
): NativeCommandIntent | null {
  const normalized = normalizeCompoundPart(part);

  const createInApp = parseCreateFileInAppCommand(normalized);
  if (createInApp) return createInApp;

  const save = parseSaveFileCommand(normalized);
  if (save) return save;

  const calc = parseCalculatorInput(normalized);
  if (calc) return desktopInputToTypeIntent(calc);

  const input = parseDesktopInputFallback(normalized);
  if (input) return desktopInputToTypeIntent(input);

  const browserSearch = parseBrowserWorkspaceSearch(normalized);
  if (browserSearch) return browserSearch;

  return parseNativeCommandStrict(normalized);
}
