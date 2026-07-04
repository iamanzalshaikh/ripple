import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

export type GoalStatus = "active" | "paused" | "completed" | "cancelled";

export type GoalState = {
  goalId: string;
  summary: string;
  status: GoalStatus;
  startedAt: number;
  updatedAt: number;
  stepIndex: number;
  stepCount: number;
  lastOutcome?: string;
};

const GOAL_FILE = join(
  process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
  "Ripple",
  "agent-goal.json",
);

function ensureDir(): void {
  const dir = join(GOAL_FILE, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function getActiveGoal(): GoalState | null {
  if (!existsSync(GOAL_FILE)) return null;
  try {
    const raw = readFileSync(GOAL_FILE, "utf8");
    const parsed = JSON.parse(raw) as GoalState;
    if (!parsed?.goalId || parsed.status === "completed" || parsed.status === "cancelled") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function startGoal(summary: string, stepCount = 0): GoalState {
  ensureDir();
  const now = Date.now();
  const goal: GoalState = {
    goalId: randomUUID(),
    summary: summary.trim(),
    status: "active",
    startedAt: now,
    updatedAt: now,
    stepIndex: 0,
    stepCount,
  };
  writeFileSync(GOAL_FILE, JSON.stringify(goal, null, 2), "utf8");
  return goal;
}

export function updateGoal(patch: Partial<GoalState>): GoalState | null {
  const current = getActiveGoal();
  if (!current) return null;
  const next: GoalState = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  };
  ensureDir();
  writeFileSync(GOAL_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function pauseGoal(): GoalState | null {
  return updateGoal({ status: "paused" });
}

export function completeGoal(outcome?: string): GoalState | null {
  return updateGoal({
    status: "completed",
    lastOutcome: outcome,
  });
}

export function clearGoal(): void {
  try {
    if (existsSync(GOAL_FILE)) {
      writeFileSync(
        GOAL_FILE,
        JSON.stringify({ status: "cancelled", updatedAt: Date.now() }),
        "utf8",
      );
    }
  } catch {
    /* ignore */
  }
}

export function parseGoalControlCommand(command: string): "pause" | "resume" | "cancel" | "continue" | null {
  const c = command.trim().toLowerCase();
  if (/^(?:pause|stop)\s+(?:the\s+)?goal\s*$/i.test(c)) return "pause";
  if (/^(?:cancel|abort)\s+(?:the\s+)?goal\s*$/i.test(c)) return "cancel";
  if (/^(?:continue|resume)\s+(?:the\s+)?goal\s*$/i.test(c)) return "continue";
  if (/^(?:keep going|continue where (?:we|i) left off)\s*$/i.test(c)) return "continue";
  return null;
}
