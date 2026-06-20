import type { CommandResultPayload } from "../types.js";
import type { PlannerSource } from "../../telemetry/commandTelemetry.js";

export type Candidate = {
  path: string;
  label: string;
  score: number;
  source: "graph" | "alias" | "windows_search" | "index" | "local" | "cache" | "semantic";
  mtime?: number;
};

export type PlanExecuteResult =
  | {
      kind: "payload";
      payload: CommandResultPayload;
      source: PlannerSource;
      confidence: number;
    }
  | { kind: "blocked"; message: string; reason: string }
  | { kind: "rephrase"; hint: string }
  | { kind: "not_found"; hint: string }
  | {
      kind: "clarify";
      question: string;
      candidates: Candidate[];
      confidence: number;
    };
