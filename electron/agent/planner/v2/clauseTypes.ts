import type { PlanStep } from "../planTypes.js";

/** Closed enum — parsers map into this; matrix maps to tools. */
export type ClauseType =
  | "APP_LAUNCH"
  | "APP_FOCUS"
  | "APP_CLOSE"
  | "WORKSPACE_OPEN"
  | "WEB_SEARCH"
  | "MEDIA_SEARCH"
  | "FILE_SEARCH"
  | "FOLDER_OPEN"
  | "FILE_OPEN"
  | "TYPE_TEXT"
  | "CLIPBOARD_OP"
  | "DRAW_SHAPE"
  | "PAINT_OP"
  | "MOUSE_ACTION"
  | "SAVE_FILE"
  | "FILE_MUTATE"
  | "UNKNOWN";

export type ClauseStatus = "resolved" | "ambiguous" | "unsupported";

export type ClauseEntities = {
  appId?: string;
  workspaceId?: string;
  workspaceUrl?: string;
  spokenName?: string;
  searchQuery?: string;
  searchEngine?: "google" | "youtube";
  folder?: string;
  filename?: string;
  itemName?: string;
  parentFolder?: string;
  typeText?: string;
  clipOp?:
    | "copy"
    | "cut"
    | "paste"
    | "read"
    | "write"
    | "select_all"
    | "select_all_copy"
    | "select_all_cut";
  clipText?: string;
  drawShape?: string;
  /** Repeat draw cycles in one clause (e.g. "draw 3 circles"). */
  drawCount?: number;
  paintOp?: "fill" | "erase" | "clear" | "label";
  paintLabel?: string;
  saveFilename?: string;
  saveFolder?: string;
};

export type ClauseRecord = {
  index: number;
  raw: string;
  normalized: string;
  clauseType: ClauseType;
  confidence: number;
  entities: ClauseEntities;
  parseSource: string;
  status: ClauseStatus;
};

export type RoutingDecision = {
  tool: string;
  args: Record<string, unknown>;
  reason: string;
  blockedTools: string[];
};

export type CompletionOutcome =
  | "EXECUTE_FULL"
  | "EXECUTE_PARTIAL_THEN_TAIL"
  | "EXECUTE_PARTIAL_THEN_MEDIA"
  | "CLARIFY_TAIL"
  | "CLARIFY_ALL"
  | "CLARIFY_AMBIGUOUS";

export type PlannerV2CompoundResult =
  | { kind: "plan"; plan: import("../planTypes.js").ExecutionPlan; outcome: CompletionOutcome }
  | {
      kind: "partial";
      plan: import("../planTypes.js").ExecutionPlan;
      unresolvedClauses: string[];
      unresolvedRecords: ClauseRecord[];
      splitPreview: import("../planTypes.js").CompoundStepPreview[];
      outcome: CompletionOutcome;
      question: string;
      confidence: number;
    }
  | {
      kind: "clarify";
      question: string;
      confidence: number;
      reason: string;
      records: ClauseRecord[];
    };

export type PlannerV2AtomicResult = {
  kind: "plan";
  plan: import("../planTypes.js").ExecutionPlan;
  record: ClauseRecord;
  step: PlanStep;
} | {
  kind: "clarify";
  question: string;
  record: ClauseRecord;
};
