import { delay } from "../../delay.js";

export async function runWaitForWindow(data?: Record<string, unknown>): Promise<string> {
  const ms = typeof data?.ms === "number" ? data.ms : 1200;
  await delay(ms);
  return `Waited ${ms}ms`;
}
