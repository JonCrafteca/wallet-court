// Wallet Court — pure telemetry persistence retry logic. No SDK, no network,
// no side effects beyond the injected `persistFn`. Unit-testable in isolation.
//
// When a NansenApiCallAudit write fails, we retry with the SAME call_id (the
// audit record is immutable — retrying with a different call_id would create
// a phantom duplicate). If all retries fail, the caller marks telemetry as
// unhealthy so the campaign halts with a visible warning.

export const TELEMETRY_RETRY_COUNT = 3;
export const TELEMETRY_RETRY_BASE_DELAY_MS = 200;

export interface RetryOutcome {
  succeeded: boolean;
  attempts: number;
  finalError: string | null;
}

// Retry a persistence operation up to TELEMETRY_RETRY_COUNT times. The record
// is passed unchanged to each attempt (same call_id). Returns the outcome.
// `persistFn` must be an async function that throws on failure. `sleepFn` is
// injected for testing.
export async function persistWithRetry(
  record: Record<string, any>,
  persistFn: (rec: Record<string, any>) => Promise<void>,
  opts: { retries?: number; baseDelayMs?: number; sleepFn?: (ms: number) => Promise<void> } = {}
): Promise<RetryOutcome> {
  const retries = opts.retries ?? TELEMETRY_RETRY_COUNT;
  const baseDelay = opts.baseDelayMs ?? TELEMETRY_RETRY_BASE_DELAY_MS;
  const sleep = opts.sleepFn || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let lastError: string | null = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await persistFn(record);
      return { succeeded: true, attempts: attempt, finalError: null };
    } catch (e: any) {
      lastError = e?.message || "Unknown persistence error";
      if (attempt < retries) {
        await sleep(baseDelay * attempt);
      }
    }
  }
  return { succeeded: false, attempts: retries, finalError: lastError };
}

// Build a safe, non-identifying telemetry warning message from a failed
// persistence outcome. Never includes the record content or call_id.
export function buildTelemetryWarning(outcome: RetryOutcome): string {
  return `Nansen call audit persistence failed after ${outcome.attempts} attempts. Campaign halted to preserve proof integrity. Last error: ${outcome.finalError || "unknown"}.`;
}