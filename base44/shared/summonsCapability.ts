// Wallet Court — Anonymous summons management capability tokens.
// Pure, unit-testable functions for generating, hashing, and verifying
// one-time management tokens that allow anonymous users to update their
// own summons without requiring login.
//
// Security guarantees:
// - The raw token is generated with crypto.getRandomValues (32 bytes / 256 bits).
// - Only a SHA-256 hash is stored server-side; the raw token is never persisted.
// - The raw token is returned exactly once, only to the creating browser.
// - Verification uses constant-time comparison to prevent timing attacks.
// - Rate limiting prevents brute-force attempts.
// - The capability grants permission ONLY to update allowed status transitions
//   for that exact summons — never ownership, defense filing, moderation,
//   deletion, or access to private data.
// - Tokens and hashes are never exposed through public responses, My Court,
//   URLs, analytics, logs, or exports.

export const CAPABILITY_TOKEN_BYTES = 32; // 256 bits of randomness
export const CAPABILITY_RATE_LIMIT_MAX = 10; // max verification attempts per window
export const CAPABILITY_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// Generate a cryptographically random management token (64 hex chars).
export function generateManagementToken(): string {
  const bytes = new Uint8Array(CAPABILITY_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Hash a raw management token using SHA-256. Returns a hex string.
// Uses the Web Crypto API (available in both Deno and browsers).
export async function hashManagementToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Verify a raw management token against a stored hash using constant-time
// comparison to prevent timing attacks.
export async function verifyManagementToken(
  rawToken: string | null | undefined,
  storedHash: string | null | undefined
): Promise<boolean> {
  if (!rawToken || !storedHash) return false;
  const hash = await hashManagementToken(rawToken);
  return constantTimeEqual(hash, storedHash);
}

// Constant-time string comparison to prevent timing attacks.
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// Check rate limit for capability verification attempts.
// Returns { ok, error }.
export function checkCapabilityRateLimit(recentAttempts: any[]): { ok: boolean; error?: string } {
  const now = Date.now();
  const windowStart = new Date(now - CAPABILITY_RATE_LIMIT_WINDOW_MS).toISOString();
  const recent = (recentAttempts || []).filter((a) => {
    const at = a.attempted_at || a.created_at;
    return at && at >= windowStart;
  });
  if (recent.length >= CAPABILITY_RATE_LIMIT_MAX) {
    return {
      ok: false,
      error: "Too many verification attempts. Please try again later.",
    };
  }
  return { ok: true };
}