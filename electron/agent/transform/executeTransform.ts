import { clipboard } from "electron";
import { hideOverlay } from "../../windows/overlay.js";
import {
  prepareDictationInsertFocus,
  restoreFocusContext,
} from "../../focus/focusContext.js";
import { delay } from "../../automation/delay.js";
import { pasteFromClipboard, selectAll } from "../../automation/keyboard.js";
import { getFocusedA11yElement } from "../../native/win32Bridge.js";
import { generateDictationCorrection } from "../dictation/aiRewriteDictation.js";

export type TransformResult = {
  ok: boolean;
  mode: "transform";
  originalText?: string;
  finalText?: string;
  inserted?: boolean;
  error?: string;
};

function normalizeForMatch(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[ \t]+/g, " ");
}

function isEditLikeControl(controlType?: string): boolean {
  const c = (controlType ?? "").toLowerCase();
  return (
    c.includes("edit") ||
    c.includes("document") ||
    c.includes("text") ||
    c.includes("code")
  );
}

function isOmniboxA11y(a11y: {
  name?: string;
  className?: string;
  automationId?: string;
} | null): boolean {
  if (!a11y) return false;
  const name = (a11y.name ?? "").toLowerCase();
  const cls = (a11y.className ?? "").toLowerCase();
  const aid = (a11y.automationId ?? "").toLowerCase();
  return (
    name.includes("address and search") ||
    cls.includes("omnibox") ||
    /^view_\d+$/.test(aid)
  );
}

/**
 * Rebuild the full field so a partial selection becomes an in-place swap.
 * Returns null when the original fragment cannot be located (caller must not
 * wipe the whole field with only the fragment rewrite).
 *
 * Empty `currentField` (WhatsApp Web contenteditable has no UIA value) is a
 * full composer replace — only safe after keyboard focus is confirmed in an
 * Edit control, not after a bare HWND restore.
 */
export function buildTransformFieldText(
  currentField: string | null | undefined,
  original: string,
  rewritten: string,
): { text: string; mode: "full" | "partial" } | null {
  const fieldRaw = (currentField ?? "").replace(/\r\n/g, "\n");
  const origRaw = original.replace(/\r\n/g, "\n");
  const next = rewritten.replace(/\r\n/g, "\n").trim();
  if (!next) return null;

  const fieldTrim = fieldRaw.trim();
  const origTrim = origRaw.trim();
  if (!fieldTrim || fieldTrim === origTrim) {
    return { text: next, mode: "full" };
  }

  // Exact substring (preferred for partial select).
  if (fieldRaw.includes(origRaw)) {
    return { text: fieldRaw.replace(origRaw, next), mode: "partial" };
  }
  if (fieldRaw.includes(origTrim)) {
    return { text: fieldRaw.replace(origTrim, next), mode: "partial" };
  }

  // Soft match: quotes / whitespace drift from clipboard vs UIA value.
  const fieldNorm = normalizeForMatch(fieldRaw);
  const origNorm = normalizeForMatch(origTrim);
  const idx = fieldNorm.indexOf(origNorm);
  if (idx >= 0) {
    const softOrig = origTrim;
    const softIdx = fieldRaw.indexOf(softOrig);
    if (softIdx >= 0) {
      return {
        text: fieldRaw.slice(0, softIdx) + next + fieldRaw.slice(softIdx + softOrig.length),
        mode: "partial",
      };
    }
  }

  if (Math.abs(fieldTrim.length - origTrim.length) <= 2) {
    return { text: next, mode: "full" };
  }

  console.warn(
    "[ripple-desktop] Transforms: selected fragment not found in field — aborting replace (won't wipe document)",
  );
  return null;
}

/** Ctrl+A + clipboard paste only — never native_text / editor-click (those append). */
async function replaceFieldViaClipboard(content: string): Promise<void> {
  await restoreFocusContext();
  await delay(200);
  clipboard.writeText(content);
  await delay(80);
  await selectAll();
  await delay(80);
  await pasteFromClipboard();
  await delay(120);
}

/**
 * P8.2 + P8.3 — Transforms.
 * Highlight text → speak an instruction → rewrite in place.
 */
export async function executeTransform(
  selectedText: string,
  instruction: string,
): Promise<TransformResult> {
  const original = selectedText.replace(/\r\n/g, "\n");
  const spoken = instruction.trim();
  if (!original.trim()) {
    return { ok: false, mode: "transform", error: "no_selection" };
  }
  if (!spoken) {
    return { ok: false, mode: "transform", originalText: original, error: "no_instruction" };
  }

  const scopedInstruction =
    `Rewrite ONLY this selected fragment. Return ONLY the rewritten fragment ` +
    `with no surrounding sentences and no quotes.\nInstruction: ${spoken}`;

  const generated = await generateDictationCorrection({
    originalText: original.trim(),
    instruction: scopedInstruction,
  });
  const finalText = generated?.generation.generatedText?.trim();
  if (!finalText) {
    return {
      ok: false,
      mode: "transform",
      originalText: original,
      error: "rewrite_failed",
    };
  }

  try {
    hideOverlay();
    // HWND restore is not enough: explorer steal leaves Chrome FG without
    // caret in the WhatsApp composer. Dictation insert uses this; transform
    // used to Ctrl+A the chat pane (field=0 fake success).
    if (!(await prepareDictationInsertFocus())) {
      return {
        ok: false,
        mode: "transform",
        originalText: original,
        finalText,
        inserted: false,
        error: "restore_failed",
      };
    }
    await delay(150);

    const a11y = await getFocusedA11yElement();
    if (!isEditLikeControl(a11y?.controlType) || isOmniboxA11y(a11y)) {
      console.warn(
        `[ripple-desktop] Transforms aborted — focus is ${a11y?.controlType ?? "none"} name="${(a11y?.name ?? "").slice(0, 40)}" (need composer Edit)`,
      );
      return {
        ok: false,
        mode: "transform",
        originalText: original,
        finalText,
        inserted: false,
        error: "composer_not_focused",
      };
    }

    const currentField = a11y?.value ?? null;
    const built = buildTransformFieldText(currentField, original, finalText);
    if (!built) {
      return {
        ok: false,
        mode: "transform",
        originalText: original,
        finalText,
        inserted: false,
        error: "selection_not_found_in_field",
      };
    }

    console.info(
      `[ripple-desktop] Transforms replace-in-place mode=${built.mode} (field=${currentField?.length ?? 0} orig=${original.trim().length} out=${built.text.length} role=${a11y?.controlType ?? "?"})`,
    );

    await replaceFieldViaClipboard(built.text);
    return {
      ok: true,
      mode: "transform",
      originalText: original,
      finalText,
      inserted: true,
    };
  } catch (e: unknown) {
    return {
      ok: false,
      mode: "transform",
      originalText: original,
      finalText,
      inserted: false,
      error: e instanceof Error ? e.message : "transform_insert_failed",
    };
  }
}
