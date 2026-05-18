/** Mirrors ripple-backend ExecutionAction — do not add new types. */
export const ACTION_TYPES = [
  "INSERT_TEXT",
  "COPY_TEXT",
  "OPEN_APP",
  "OPEN_URL",
  "SHOW_SUGGESTIONS",
  "WORKFLOW",
  "NOOP",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export interface RippleAction {
  type: ActionType;
  status?: "pending" | "executed" | "failed";
  data?: Record<string, unknown>;
}

export interface CommandResultPayload {
  command_id?: string;
  intent?: string;
  result?: string;
  actions?: RippleAction[];
  output_type?: string;
  message?: string;
}

export interface ActionAckPayload {
  command_id: string;
  action_index: number;
  status: "executed" | "failed";
  error?: string;
}

export interface ActionRunRecord {
  index: number;
  type: ActionType;
  status: "executed" | "failed";
  error?: string;
  detail?: string;
}

export interface ActionRunSummary {
  command_id: string;
  records: ActionRunRecord[];
  allSucceeded: boolean;
}
