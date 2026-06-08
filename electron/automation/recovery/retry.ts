export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { attempts?: number; delayMs?: number; label?: string } = {},
): Promise<T> {
  const attempts = options.attempts ?? 2;
  const delayMs = options.delayMs ?? 400;
  const label = options.label ?? "operation";
  let last: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      last = e;
      if (i < attempts - 1) {
        console.warn(
          `[ripple-desktop] retry ${label} attempt ${i + 1}/${attempts} failed:`,
          e instanceof Error ? e.message : e,
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  throw last;
}
