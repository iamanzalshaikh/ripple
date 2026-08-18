import {
  isIdeProcess,
  readOpenIdeFileContent,
  readWorkspaceFileByBasename,
} from "./ideContext.js";

const JS_KEYWORDS = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "with",
  "async",
  "await",
  "from",
  "of",
  "type",
  "interface",
  "enum",
  "implements",
  "package",
  "private",
  "protected",
  "public",
  "static",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Pull camelCase / snake_case identifiers from editor source. */
export function extractCodeIdentifiers(source: string): string[] {
  const found = new Set<string>();
  const re = /\b[A-Za-z_$][\w$]*\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const id = m[0];
    if (id.length < 3) continue;
    if (JS_KEYWORDS.has(id)) continue;
    const codeLike =
      id.includes("_") ||
      /[a-z][A-Z]/.test(id) ||
      /^[A-Z][a-z]+/.test(id) ||
      id.length >= 10;
    if (!codeLike) continue;
    found.add(id);
  }
  return [...found].sort((a, b) => b.length - a.length);
}

function identifierToSpokenWords(id: string): string[] {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

export type VariableRecognitionResult = {
  text: string;
  replacements: Array<{ from: string; to: string }>;
};

function filesNamedInText(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/@?([A-Za-z0-9][\w-]*\.[A-Za-z0-9]{1,8})\b/g)) {
    names.add(match[1]!);
  }
  return [...names];
}

function gatherIdentifierSource(
  text: string,
  processName?: string | null,
  sourceOverride?: string | null,
): string {
  if (sourceOverride?.trim()) return sourceOverride;
  const chunks: string[] = [];
  const open = readOpenIdeFileContent(processName);
  if (open) chunks.push(open);
  for (const name of filesNamedInText(text)) {
    const body = readWorkspaceFileByBasename(name, processName);
    if (body) chunks.push(body);
  }
  return chunks.join("\n");
}

/**
 * Match spoken words to code identifiers from the open file and any
 * filenames mentioned in the utterance (workspace, not only the current tab).
 * Text-only — does not touch insert or focus.
 */
export function applyVariableRecognition(
  text: string,
  processName?: string | null,
  sourceOverride?: string | null,
): VariableRecognitionResult {
  if (!text.trim() || !isIdeProcess(processName)) {
    return { text, replacements: [] };
  }

  const source = gatherIdentifierSource(text, processName, sourceOverride);
  if (!source.trim()) return { text, replacements: [] };

  const identifiers = extractCodeIdentifiers(source);
  if (!identifiers.length) return { text, replacements: [] };

  let out = text.replace(/\bunderscore\b/gi, "_");
  const replacements: Array<{ from: string; to: string }> = [];

  for (const id of identifiers) {
    const words = identifierToSpokenWords(id);
    if (words.length < 2) continue;
    const pattern = words.map((w) => escapeRegExp(w)).join("\\s+");
    const re = new RegExp(`\\b${pattern}\\b`, "gi");
    out = out.replace(re, (spoken) => {
      if (spoken === id) return spoken;
      replacements.push({ from: spoken, to: id });
      return id;
    });
  }

  return { text: out, replacements };
}
