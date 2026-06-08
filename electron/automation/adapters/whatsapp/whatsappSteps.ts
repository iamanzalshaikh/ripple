/** Step-by-step WhatsApp CDP logging — grep terminal for `[WhatsApp]`. */
export function logWaStep(
  step: string,
  ok: boolean,
  detail?: string,
): void {
  const suffix = detail ? ` — ${detail}` : "";
  console.info(`[WhatsApp] ${step}=${ok}${suffix}`);
}

export class WhatsAppPipelineError extends Error {
  constructor(
    public readonly step: string,
    message: string,
  ) {
    super(message);
    this.name = "WhatsAppPipelineError";
  }
}

export function failStep(step: string, message: string): never {
  logWaStep(step, false, message);
  throw new WhatsAppPipelineError(step, message);
}
