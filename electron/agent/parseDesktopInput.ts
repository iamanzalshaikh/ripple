import type { DesktopInputParsed } from "./types.js";
import type { TypeTextIntent } from "../automation/desktop/parseNativeCommand.js";
import type { WorldModel } from "./types.js";
import {
  normalizeUrdu,
  normalizeUrduEditCommands,
} from "../automation/voice/i18n/urduNormalize.js";
import { isGmailVoiceCommand } from "../automation/commandIntent.js";

/** Strip STT stutter like "Write, Write 25" → "25". */
export function normalizeVoiceStutter(command: string): string {
  let s = command
    .trim()
    .replace(/[.?!]+$/g, "")
    .replace(/\s+/g, " ");

  if (/^write\b/i.test(s)) {
    const withoutWrite = s.replace(/^(?:write\s*,?\s*)+/i, "").trim();
    if (withoutWrite && withoutWrite !== s) {
      if (/^[\d\s.+*/x\-]+$/i.test(withoutWrite) || /^\d+\s+(?:plus|minus|times|divided by|over)\s+\d+/i.test(withoutWrite)) {
        return withoutWrite;
      }
      return `write ${withoutWrite}`;
    }
  }

  return s;
}

/** STT homophones and spacing fixes for desktop edit commands. */
export function normalizeDesktopVoiceCommand(command: string): string {
  let s = normalizeVoiceStutter(command);
  s = normalizeUrduEditCommands(s);
  s = normalizeUrdu(s);
  const normalized = s.toLowerCase().replace(/[,\s]+/g, " ").trim();
  if (/^paste\s+(?:hier|hear|hair|hare)$/i.test(normalized)) {
    return "paste here";
  }
  if (/^paste\s+this\s+(?:hier|hear|hair|hare)$/i.test(normalized)) {
    return "paste this here";
  }
  if (/^select\s+alland\s+copy$/i.test(normalized)) {
    return "select all and copy";
  }
  if (/^select\s+all\s+andcopy$/i.test(normalized)) {
    return "select all and copy";
  }
  // STT often says "mouse cursor" when the user means text caret in an editor.
  if (/\bmouse\s+cursor\b/i.test(s)) {
    s = s.replace(/\bmouse\s+cursor\b/gi, "cursor");
  }
  return s;
}

export function isCalculatorForeground(world?: WorldModel | null): boolean {
  if (!world?.foreground) return false;
  const proc = (world.foreground.processName ?? "").toLowerCase();
  const title = (world.foreground.windowTitle ?? "").toLowerCase();
  return title.includes("calculator") || proc.includes("calc");
}

export function isExplorerForeground(world?: WorldModel | null): boolean {
  return (world?.foreground?.processName ?? "").toLowerCase() === "explorer";
}

/** Map spoken math into Calculator key input when Calculator is focused. */
export function parseCalculatorInput(command: string): DesktopInputParsed | null {
  const raw = normalizeVoiceStutter(command).trim();
  if (!raw) return null;

  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    return { mode: "text", text: raw };
  }

  const spoken = raw.match(
    /^(?:calculate\s+)?(\d+(?:\.\d+)?)\s+(plus|minus|times|multiplied\s+by|divided\s+by|over)\s+(\d+(?:\.\d+)?)$/i,
  );
  if (spoken) {
    const ops: Record<string, string> = {
      plus: "+",
      minus: "-",
      times: "*",
      "multiplied by": "*",
      "divided by": "/",
      over: "/",
    };
    const op = ops[spoken[2].toLowerCase()];
    if (op) {
      return { mode: "text", text: `${spoken[1]}${op}${spoken[3]}=` };
    }
  }

  const compact = raw.replace(/\s+/g, "");
  if (/^[\d.+*/x\-=]+$/.test(compact) && /[+\-*/]/.test(compact)) {
    return {
      mode: "text",
      text: compact.replace(/x/gi, "*").replace(/=$/, "") + "=",
    };
  }

  const typed = extractDirectTypingText(raw);
  if (typed && /^[\d\s.+*/x\-]+$/i.test(typed)) {
    const t = typed.replace(/\s+/g, "");
    return {
      mode: "text",
      text: t.replace(/x/gi, "*").replace(/=$/, "") + (t.includes("=") ? "" : "="),
    };
  }

  return null;
}

function parseSpokenCount(text: string): number {
  const m = text.match(/\b(\d+)\b/);
  if (m?.[1]) return Math.max(1, Math.min(20, Number(m[1])));
  if (/\b(?:twice|two)\b/i.test(text)) return 2;
  if (/\b(?:thrice|three)\b/i.test(text)) return 3;
  return 1;
}

/** Compose request without literal body — needs GPT / LLM. */
const COMPOSE_TOPIC_ONLY =
  /^(?:can you )?(?:please )?(?:write|compose|draft)(?:\s+me)?\s+(?:an?\s+)?(?:professional\s+)?(?:email|message|letter|note|reply|response)(?:\s+(?:to|for|about)\s+.+?)?\s*$/i;

export function isComposeTopicOnlyCommand(command: string): boolean {
  const raw = normalizeDesktopVoiceCommand(command.trim());
  return COMPOSE_TOPIC_ONLY.test(raw);
}

/** Natural-language typing phrases — P9 L0 reflex layer. */
export function extractDirectTypingText(command: string): string | null {
  const cleaned = normalizeVoiceStutter(command);
  if (isComposeTopicOnlyCommand(cleaned)) return null;
  if (isGmailVoiceCommand(cleaned)) return null;

  const patterns = [
    /^(?:can you\s+)?(?:please\s+)?type\s+karo\s+(.+)$/i,
    /^(?:can you\s+)?(?:please\s+)?(?:type|insert(?:\s+text)?)\s+(?:exactly\s+)?["“]?(.+?)["”]?(?:\s+(?:in(?:to)?\s+(?:this\s+)?(?:window|app|editor|textbox|notepad)|here))?$/i,
    /^(?:can you\s+)?(?:please\s+)?(?:write|put|enter|say)\s+(?:down\s+)?["“]?(.+?)["”]?(?:\s+(?:here|in\s+this\s+(?:window|app|field))?)?$/i,
    /^(?:please\s+)?(?:dictate|speak)\s+["“]?(.+?)["”]?$/i,
    /^(?:please\s+)?(?:likho|likh\s+do|likhna)\s+(.+)$/i,
    /^(?:please\s+)?(?:yahan|idhar)\s+(?:likho|type\s+karo)\s+(.+)$/i,
  ];

  for (const re of patterns) {
    const match = cleaned.match(re);
    if (match?.[1]?.trim()) return match[1].trim();
  }

  return null;
}

/** Editor "clear all text" — not a filesystem delete_file operation. */
export function isEditorClearTextPhrase(command: string): boolean {
  const n = command.trim().toLowerCase().replace(/\s+/g, " ");
  if (
    /^(?:delete|clear|remove)\s+all(?:\s+the)?\s+(?:text|content|everything)(?:\s+and\s+(?:write|type|insert|put)\b.*)?$/i.test(
      n,
    )
  ) {
    return true;
  }
  if (/^(?:delete|clear|remove)\s+all(?:\s+text)?$/i.test(n)) return true;
  if (/^(?:clear|remove)\s+everything$/i.test(n)) return true;
  return false;
}

function editorClearSequence(): DesktopInputParsed {
  return {
    mode: "sequence",
    sequence: [
      { value: "^a", delayMs: 40 },
      { value: "{BACKSPACE}", delayMs: 40 },
    ],
  };
}

function keySequence(
  pairs: Array<[string, number?]>,
): DesktopInputParsed {
  return {
    mode: "sequence",
    sequence: pairs.map(([value, delayMs]) => ({
      value,
      delayMs: delayMs ?? 40,
    })),
  };
}

/** Multi-step keyboard compounds — must not split on "and" into type_text workflow. */
export function parseKeyboardCompoundSequence(
  normalized: string,
): DesktopInputParsed | null {
  const n = normalized.replace(/\s+/g, " ").trim();

  if (
    /^select all and paste(?:\s+(?:it|here|this|that|what i copied))?$/i.test(n)
  ) {
    return keySequence([
      ["^a", 40],
      ["^v", 80],
    ]);
  }
  if (
    /^(?:highlight|select)\s+(?:all|everything)\s+and\s+paste(?:\s+(?:it|here|this|what i copied))?$/i.test(
      n,
    )
  ) {
    return keySequence([
      ["^a", 40],
      ["^v", 80],
    ]);
  }
  if (
    /^(?:select all|highlight all)(?:\s+and)?\s+copy\s+and\s+paste(?:\s+here)?$/i.test(
      n,
    )
  ) {
    return keySequence([
      ["^a", 40],
      ["^c", 120],
      ["^v", 80],
    ]);
  }
  if (/^copy\s+and\s+paste(?:\s+(?:it|here|this))?$/i.test(n)) {
    return keySequence([
      ["^c", 40],
      ["^v", 80],
    ]);
  }
  if (/^cut\s+and\s+paste(?:\s+(?:it|here|this))?$/i.test(n)) {
    return keySequence([
      ["^x", 40],
      ["^v", 80],
    ]);
  }
  if (/^select all\s*,\s*paste(?:\s+here)?$/i.test(n)) {
    return keySequence([
      ["^a", 40],
      ["^v", 80],
    ]);
  }
  return null;
}

/** Parse desktop keyboard / typing voice commands without GPT. */
export function parseDesktopInputFallback(
  command: string,
): DesktopInputParsed | null {
  const raw = normalizeDesktopVoiceCommand(command);
  const lower = raw.toLowerCase();
  const normalized = lower.replace(/[,\s]+/g, " ").trim();

  const keyboardCompound = parseKeyboardCompoundSequence(normalized);
  if (keyboardCompound) return keyboardCompound;

  // STT homophone: "that's all" often means "select all" in editors.
  if (/^that'?s all$/i.test(normalized)) {
    return { mode: "keys", keys: "^a" };
  }

  if (isPasteClipboardCommand(normalized)) {
    return { mode: "keys", keys: "^v" };
  }

  if (
    /^copy(?:\s+(?:this(?:\s+text)?|that(?:\s+text)?|the\s+selected\s+content|selected\s+content|text))?$/i.test(
      normalized,
    )
  ) {
    return { mode: "keys", keys: "^c" };
  }
  if (
    /^cut(?:\s+(?:this(?:\s+text)?|that(?:\s+text)?|the\s+selected\s+content|selected\s+content|text|everything))?$/i.test(
      normalized,
    )
  ) {
    return { mode: "keys", keys: "^x" };
  }
  if (
    /^(?:take|grab)\s+(?:this|that)\s+text\s+and\s+copy\s+it$/i.test(normalized)
  ) {
    return { mode: "keys", keys: "^c" };
  }
  if (
    /^(?:remove|delete)\s+(?:this|that)\s+text\s+and\s+copy\s+it$/i.test(
      normalized,
    )
  ) {
    return { mode: "keys", keys: "^x" };
  }
  if (/^select all and copy(?:\s+(?:this(?:\s+text)?|text))?$/i.test(normalized)) {
    return {
      mode: "sequence",
      sequence: [
        { value: "^a", delayMs: 150 },
        { value: "^c", delayMs: 120 },
      ],
    };
  }
  if (/^select all and cut(?:\s+(?:this(?:\s+text)?|text|everything))?$/i.test(normalized)) {
    return {
      mode: "sequence",
      sequence: [
        { value: "^a", delayMs: 40 },
        { value: "^x", delayMs: 40 },
      ],
    };
  }

  if (isComposeTopicOnlyCommand(raw)) {
    return null;
  }

  const clearAndWrite = normalized.match(
    /^(?:delete|clear|remove)\s+all(?:\s+the)?\s+(?:text|content|everything)\s+and\s+(?:write|type|insert|put)\s*[:,]?\s*(.+)$/i,
  );
  if (clearAndWrite?.[1]?.trim()) {
    return { mode: "text", text: clearAndWrite[1].trim(), replaceAll: true };
  }

  if (
    /^(?:delete|clear|remove)\s+all(?:\s+the)?\s+(?:text|content)$/i.test(
      normalized,
    )
  ) {
    return editorClearSequence();
  }

  const typed = extractDirectTypingText(raw);
  if (typed) return { mode: "text", text: typed };

  const replaceWrite = raw.match(
    /^(?:delete|clear|remove)\s+(?:all(?:\s+the)?\s+)?(?:text|content|everything)\s+(?:and\s+)?(?:write|type|insert|put)\s*[:,]?\s*(.+)$/i,
  );
  if (replaceWrite?.[1]?.trim()) {
    return { mode: "text", text: replaceWrite[1].trim(), replaceAll: true };
  }

  if (/^(?:press|hit|tap)\s+enter$/i.test(normalized)) {
    return { mode: "keys", keys: "{ENTER}" };
  }
  if (/^(?:press|hit|tap)\s+tab$/i.test(normalized)) {
    return { mode: "keys", keys: "{TAB}" };
  }
  if (/^(?:press|hit|tap)\s+escape$/i.test(normalized)) {
    return { mode: "keys", keys: "{ESC}" };
  }
  if (/^(?:press|hit|tap)\s+backspace$/i.test(normalized)) {
    return { mode: "keys", keys: "{BACKSPACE}" };
  }
  if (/^(?:press|hit|tap)\s+delete$/i.test(normalized)) {
    return { mode: "keys", keys: "{DELETE}" };
  }

  if (/^(?:click|tap)(?:\s+here)?$/i.test(normalized)) {
    return { mode: "mouse", action: "click" };
  }
  if (/^double click(?:\s+here)?$/i.test(normalized)) {
    return { mode: "mouse", action: "double_click" };
  }
  if (/^scroll up$/i.test(normalized)) {
    return { mode: "keys", keys: "{PGUP}" };
  }
  if (/^scroll down$/i.test(normalized)) {
    return { mode: "keys", keys: "{PGDN}" };
  }
  if (/^page up$/i.test(normalized)) {
    return { mode: "keys", keys: "{PGUP}" };
  }
  if (/^page down$/i.test(normalized)) {
    return { mode: "keys", keys: "{PGDN}" };
  }

  const mouseMove = normalized.match(
    /^move\s+(?:(?:the|my)\s+)?mouse\s+(left|right|up|down)(?:\s+(\d+))?(?:\s+pixels?)?$/i,
  );
  if (mouseMove?.[1]) {
    const pixels = mouseMove[2] ? Math.min(500, Number(mouseMove[2])) : 100;
    const dir = mouseMove[1].toLowerCase();
    const delta =
      dir === "left"
        ? { deltaX: -pixels, deltaY: 0 }
        : dir === "right"
          ? { deltaX: pixels, deltaY: 0 }
          : dir === "up"
            ? { deltaX: 0, deltaY: -pixels }
            : { deltaX: 0, deltaY: pixels };
    return { mode: "mouse", action: "move", ...delta };
  }

  if (/^move\s+mouse\s+to\s+(?:the\s+)?center$/i.test(normalized)) {
    return { mode: "mouse", action: "move_to_center" };
  }

  if (/^(?:select all|highlight all|select everything)$/i.test(normalized)) {
    return { mode: "keys", keys: "^a" };
  }
  if (/^copy(?:\s+(?:this|that|text))?$/i.test(normalized)) {
    return { mode: "keys", keys: "^c" };
  }
  if (/^cut(?:\s+(?:this|that|text))?$/i.test(normalized)) {
    return { mode: "keys", keys: "^x" };
  }
  if (/^delete all(?:\s+text)?$/i.test(normalized)) {
    return editorClearSequence();
  }
  if (/^(?:delete|clear|remove)\s+all(?:\s+the)?\s+text$/i.test(normalized)) {
    return editorClearSequence();
  }
  if (/^(?:clear|remove)(?:\s+all(?:\s+text)?|\s+everything)$/i.test(normalized)) {
    return editorClearSequence();
  }
  if (/^(?:delete|remove)(?:\s+(?:this|that|selected|selection|it))?$/i.test(normalized)) {
    return { mode: "keys", keys: "{DELETE}" };
  }
  if (/^undo(?:\s+that)?$/i.test(normalized)) {
    return { mode: "keys", keys: "^z" };
  }
  if (/^redo(?:\s+that)?$/i.test(normalized)) {
    return { mode: "keys", keys: "^y" };
  }
  if (/^select all and cut$/i.test(normalized)) {
    return {
      mode: "sequence",
      sequence: [
        { value: "^a", delayMs: 40 },
        { value: "^x", delayMs: 40 },
      ],
    };
  }
  if (/^select all and copy$/i.test(normalized)) {
    return {
      mode: "sequence",
      sequence: [
        { value: "^a", delayMs: 150 },
        { value: "^c", delayMs: 120 },
      ],
    };
  }

  if (/^delete last word$/i.test(normalized)) {
    return { mode: "keys", keys: "^+{LEFT}{BACKSPACE}" };
  }
  if (/^delete last line$/i.test(normalized)) {
    return { mode: "keys", keys: "+{HOME}{BACKSPACE}" };
  }

  if (
    /^move\s+(?:my\s+|the\s+)?(?:cursor|caret)\s+to\s+(?:the\s+)?start(?:\s+of\s+line)?$/i.test(
      normalized,
    )
  ) {
    return { mode: "keys", keys: "{HOME}" };
  }
  if (
    /^move\s+(?:my\s+|the\s+)?(?:cursor|caret)\s+to\s+(?:the\s+)?end(?:\s+of\s+line)?$/i.test(
      normalized,
    )
  ) {
    return { mode: "keys", keys: "{END}" };
  }

  const dirMap: Record<string, string> = {
    left: "{LEFT}",
    right: "{RIGHT}",
    up: "{UP}",
    down: "{DOWN}",
  };
  const dirMatch = normalized.match(
    /^(?:move\s+(?:my\s+|the\s+)?(?:cursor|caret)|go|(?:cursor|caret))\s+(?:to\s+)?(left|right|up|down)(?:\s+(?:by\s+)?(?:\d+|one|two|three|twice|thrice)\s*(?:step|steps|time|times|characters?|chars?)?)?$/i,
  );
  if (dirMatch?.[1]) {
    const count = parseSpokenCount(normalized);
    const value = dirMap[dirMatch[1]];
    if (!value) return null;
    return {
      mode: "sequence",
      sequence: Array.from({ length: count }, () => ({ value, delayMs: 30 })),
    };
  }

  return null;
}

/** Voice variants that mean Ctrl+V — not literal text to type. */
export function isPasteClipboardCommand(normalized: string): boolean {
  return (
    /^paste(?:\s+the text)?\s+(?:which\s+)?you copied$/i.test(normalized) ||
    /^paste(?:\s+(?:the|my))?\s+(?:clipboard(?:\s+content)?|copied(?:\s+text)?|what i copied)$/i.test(
      normalized,
    ) ||
    /^paste(?:\s+this(?:\s+text)?)?$/i.test(normalized) ||
    /^paste(?:\s+here)?$/i.test(normalized) ||
    /^paste(?:\s+this)?\s*(?:text\s+)?here$/i.test(normalized) ||
    /^paste\s+(?:hier|hear|hair|hare)$/i.test(normalized) ||
    /^paste\s+this\s+(?:hier|hear|hair|hare)$/i.test(normalized)
  );
}

const READ_CLIPBOARD_RE =
  /^(?:please\s+)?(?:(?:read|show)\s+(?:me\s+)?(?:what(?:'s| is)\s+(?:on|in)\s+)?(?:my\s+)?clipboard|clipboard\s+(?:read|contents?))\s*$/i;
const COPY_TO_CLIPBOARD_RE =
  /^(?:please\s+)?(?:copy|put)\s+(.+?)\s+(?:to|on|into)\s+(?:the\s+)?clipboard\s*$/i;

export type ClipboardOpKind =
  | "copy"
  | "cut"
  | "paste"
  | "read"
  | "write"
  | "select_all"
  | "select_all_copy"
  | "select_all_cut";

export function clipboardOpFromDesktopInput(
  parsed: DesktopInputParsed,
): ClipboardOpKind | null {
  if (parsed.mode === "keys") {
    if (parsed.keys === "^c") return "copy";
    if (parsed.keys === "^x") return "cut";
    if (parsed.keys === "^v") return "paste";
    if (parsed.keys === "^a") return "select_all";
  }
  if (parsed.mode === "sequence" && parsed.sequence.length >= 2) {
    const keys = parsed.sequence.map((s) => s.value);
    if (keys[0] === "^a" && keys[1] === "^c") return "select_all_copy";
    if (keys[0] === "^a" && keys[1] === "^x") return "select_all_cut";
  }
  return null;
}

/** Atomic clipboard utterances for planner v2 / L0. */
export function parseClipboardCommand(
  command: string,
): { op: ClipboardOpKind; text?: string } | null {
  const raw = normalizeDesktopVoiceCommand(command.trim());
  if (!raw) return null;
  const normalized = raw.toLowerCase().replace(/[,\s]+/g, " ").trim();

  if (READ_CLIPBOARD_RE.test(raw)) return { op: "read" };
  const copyTo = raw.match(COPY_TO_CLIPBOARD_RE);
  if (copyTo?.[1]?.trim()) return { op: "write", text: copyTo[1].trim() };

  const input = parseDesktopInputFallback(raw);
  if (!input) return null;
  const op = clipboardOpFromDesktopInput(input);
  return op ? { op } : null;
}

export function desktopInputToTypeIntent(
  parsed: DesktopInputParsed,
): TypeTextIntent {
  if (parsed.mode === "text") {
    return {
      kind: "type_text",
      text: parsed.text,
      replaceAll: parsed.replaceAll === true,
    };
  }
  if (parsed.mode === "keys") {
    return { kind: "type_text", keys: parsed.keys };
  }
  if (parsed.mode === "mouse") {
    return { kind: "type_text", keys: undefined };
  }
  return { kind: "type_text", sequence: parsed.sequence };
}
