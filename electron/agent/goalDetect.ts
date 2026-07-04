/** Multi-step goal language — routes to agent compound planner (P9). */
const AGENT_GOAL_MARKERS =
  /\b(?:prepare(?:\s+me)?|help\s+me|set\s+up|get\s+ready|before\s+my|plan\s+for|organize|workflow)\b/i;

const COMPOUND_CONNECTOR =
  /\s+(?:and|aur|then|phir|plus|\+|,)\s+/i;

export function isAgentGoalCommand(command?: string | null): boolean {
  const raw = (command ?? "").trim();
  if (!raw) return false;
  if (AGENT_GOAL_MARKERS.test(raw)) return true;
  if (COMPOUND_CONNECTOR.test(raw) && raw.split(COMPOUND_CONNECTOR).length >= 2) {
    return true;
  }
  return false;
}
