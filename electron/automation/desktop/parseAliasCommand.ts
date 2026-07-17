import { normalizeTranscript } from "../voice/normalizeTranscript.js";
import { isEditorClearTextPhrase } from "../../agent/parseDesktopInput.js";
import { resolveAlias } from "./aliasRegistry.js";
import type { UserAlias } from "./aliasRegistry.js";
import { normalizeSpokenPath } from "./spokenPath.js";
import { sanitizeSpokenName } from "./spokenName.js";

export type AliasIntent =
  | { kind: "open_alias"; alias: UserAlias; spokenName: string }
  | { kind: "remember_alias"; name: string; path: string }
  | { kind: "list_aliases" }
  | { kind: "remove_alias"; name: string };

export function parseAliasMetaCommand(
  command?: string | null,
): AliasIntent | null {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd) return null;

  if (
    /^\s*remember\s+(?:that\s+)?(?:i\s+)?use\s+.+\s+as\s+(?:my\s+)?ide\b/i.test(
      cmd,
    )
  ) {
    return null;
  }
  if (/^\s*remember\s+.+\s+as\s+(?:my\s+)?main\s+project\b/i.test(cmd)) {
    return null;
  }
  if (/^\s*learn\s+(?:that\s+)?.+\s+means\s+/i.test(cmd)) {
    return null;
  }

  if (/(?:^|\s)(?:list|show)\s+(?:my\s+)?aliases?\s*\.?\s*$/i.test(cmd)) {
    return { kind: "list_aliases" };
  }

  // "Remember test in Downloads"
  const rememberIsIn = cmd.match(
    /^\s*remember\s+(?:my\s+)?(.+?)\s+is\s+in\s+(downloads?|documents?|desktop)(?:,?\s*)?(.+)?\s*\.?\s*$/i,
  );
  if (rememberIsIn?.[1] && rememberIsIn[2]) {
    const name = rememberIsIn[1].trim();
    const sub = rememberIsIn[3]?.trim() || name;
    return {
      kind: "remember_alias",
      name,
      path: normalizeSpokenPath(`in ${rememberIsIn[2]} ${sub}`),
    };
  }

  const rememberIn = cmd.match(
    /^\s*remember\s+(?:my\s+)?(?:that\s+)?(.+?)\s+in\s+(downloads?|documents?|desktop)\s*\.?\s*$/i,
  );
  if (rememberIn?.[1] && rememberIn[2]) {
    if (/\bis\s+in\s+(?:downloads?|documents?|desktop)\b/i.test(cmd)) {
      return null;
    }
    return {
      kind: "remember_alias",
      name: rememberIn[1].trim(),
      path: normalizeSpokenPath(`in ${rememberIn[2]} ${rememberIn[1].trim()}`),
    };
  }

  // "Remember my test 1 is in download, test 1"
  const rememberIs = cmd.match(
    /^\s*remember\s+(?:my\s+)?(?:that\s+)?(.+?)\s+is\s+(.+?)\s*\.?\s*$/i,
  );
  if (rememberIs?.[1] && rememberIs[2]) {
    if (/\bis\s+in\s+(?:downloads?|documents?|desktop)\b/i.test(cmd)) {
      return null;
    }
    const path = rememberIs[2].trim();
    const pathLike =
      /\b(in\s+)?(downloads?|documents?|desktop)\b/i.test(path) ||
      /\busers\b/i.test(path) ||
      /^see\s+users\b/i.test(path);

    if (!/^https?:\/\//i.test(path)) {
      if (pathLike || (!path.includes(",") && !/\s+and\s+/i.test(path))) {
        return {
          kind: "remember_alias",
          name: sanitizeSpokenName(rememberIs[1]),
          path: normalizeSpokenPath(path),
        };
      }
    }
  }

  const rememberAs = cmd.match(
    /^\s*remember\s+(.+?)\s+as\s+(.+?)\s*\.?\s*$/i,
  );
  if (rememberAs?.[1] && rememberAs[2]) {
    return {
      kind: "remember_alias",
      name: rememberAs[1].trim(),
      path: normalizeSpokenPath(rememberAs[2].trim()),
    };
  }

  const forget = cmd.match(
    /^\s*(?:forget|remove)\s+(?!workflow\b)(?:alias\s+)?(.+?)\s*\.?\s*$/i,
  );
  if (forget?.[1] && !isEditorClearTextPhrase(cmd)) {
    return { kind: "remove_alias", name: sanitizeSpokenName(forget[1]) };
  }

  return null;
}

function resolveAliasForOpen(cmd: string, spoken: string): UserAlias | null {
  const direct = resolveAlias(spoken);
  if (direct) return direct;

  if (/^\s*open\s+my\s+/i.test(cmd)) {
    const withMy = resolveAlias(`my ${spoken}`);
    if (withMy) return withMy;
    const withoutMy = spoken.startsWith("my ")
      ? resolveAlias(spoken.slice(3))
      : null;
    if (withoutMy) return withoutMy;
  }

  return null;
}

/** "Open my portfolio" — resolves user alias before generic search. */
export function parseAliasOpenCommand(
  command?: string | null,
): AliasIntent | null {
  const cmd = normalizeTranscript(command ?? "");
  if (!cmd) return null;

  const openMatch = cmd.match(/^\s*open\s+(?:my\s+)?(.+?)\s*\.?\s*$/i);
  if (!openMatch?.[1]) return null;

  if (/\s+(?:in|on)\s+(?:my\s+)?(?:downloads?|documents?|desktop)\s*$/i.test(cmd)) {
    return null;
  }

  const spoken = openMatch[1].trim();
  if (/^(?:move|rename|delete|send|copy|create)\b/i.test(spoken)) return null;

  const alias = resolveAliasForOpen(cmd, spoken);
  if (!alias) return null;

  return { kind: "open_alias", alias, spokenName: spoken };
}
