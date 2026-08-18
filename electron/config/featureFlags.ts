/**
 * Product-track flags. Wispr Flow (dictation) is the shipping product.
 * Jarvis (Ctrl+Space agent / planner / OS tools) stays in the repo but
 * is gated off unless RIPPLE_JARVIS=1.
 *
 * Do not delete or mass-comment Jarvis files — that breaks tests and
 * makes it hard to turn the agent back on later.
 */

/** Ctrl+Space command/agent. Default OFF for the Wispr Flow track. */
export function isJarvisEnabled(): boolean {
  return process.env.RIPPLE_JARVIS === "1";
}
