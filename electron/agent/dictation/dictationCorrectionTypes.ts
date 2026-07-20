export type SignalKind =
  | "double_no"
  | "scratch_that"
  | "delete_directive"
  | "actually_no"
  | "bare_actually"
  | "single_no"
  | "revision_cue"
  | "tone_directive"
  | "none";

export type CorrectionType =
  | "replace"
  | "delete"
  | "append"
  | "tone_change"
  | "rewrite"
  | "none";

export type CorrectionScope = "word" | "phrase" | "sentence" | "full_buffer";

export type CorrectionDecision = {
  isCorrection: boolean;
  type: CorrectionType;
  scope: CorrectionScope;
  confidence: number;
  original: string | null;
  replacement: string | null;
  rewriteInstruction: string | null;
  correctionReason:
    | "date_change"
    | "time_change"
    | "name_change"
    | "location_change"
    | "number_change"
    | "word_replacement"
    | "tone_adjustment"
    | "grammar_fix"
    | "delete_content"
    | "unknown"
    | null;
  reason: string;
};

export type SignalDetection = {
  detected: boolean;
  signal: SignalKind;
  confidence: number;
  requiresLLM: boolean;
  candidate?: CorrectionDecision;
  /** Marker boundaries in currentUtterance for mechanical correction cleanup. */
  marker?: { start: number; end: number };
  observation?: string;
};

export type DictationGeneration = {
  generatedText: string;
  droppedContent: string[];
};

export type DictationDecisionLog = {
  input: string;
  layer1Signal: SignalKind;
  layer1AutoApplied: boolean;
  layer2aCalled: boolean;
  layer2aDecision: CorrectionDecision | null;
  layer2bCalled: boolean;
  layer2bDecision: DictationGeneration | null;
  applied: boolean;
  dropped: string[];
  finalText: string;
  latencyMs: number;
  modelUsed: string;
  reason: string;
};

export type ProductionDictationRewriteResult = {
  finalText: string;
  kind: CorrectionType | SignalKind;
  beforeMemory: string;
  decisionLog: DictationDecisionLog;
};
