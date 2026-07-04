/** P8.5 runtime trace — enable with RIPPLE_P85_TRACE=1 */

export function isPlannerTraceEnabled(): boolean {
  return process.env.RIPPLE_P85_TRACE === "1";
}

export function tracePlannerBranch(
  stage: string,
  branch: string,
  inputScope: "full" | "clause" | "plan",
  detail?: string,
): void {
  if (!isPlannerTraceEnabled()) return;
  const extra = detail ? ` ${detail}` : "";
  console.info(
    `[ripple-p85] trace stage=${stage} branch=${branch} scope=${inputScope}${extra}`,
  );
}

export function tracePipelineTier(
  tier: "sync" | "cache" | "entity" | "grounded" | "gpt" | "compound_gate",
  reason?: string,
): void {
  if (!isPlannerTraceEnabled()) return;
  console.info(
    `[ripple-p85] trace tier=${tier}${reason ? ` reason=${reason}` : ""}`,
  );
}

export function traceExecutorPayload(tools: string[]): void {
  if (!isPlannerTraceEnabled()) return;
  console.info(`[ripple-p85] trace executor-payload tools=${tools.join(",")}`);
}
