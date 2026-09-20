// Wallet Court — chain-specific wallet validation. Pure, testable, shared
// between the frontend (src/lib/walletValidation.js mirror) and the backend
// (analyzeWalletWithNansen). The backend is authoritative; the frontend mirror
// provides immediate feedback before the request is sent.
//
// Solana: must be valid Base58 decoding to exactly 32 bytes. An EVM-style 0x…
// address is always rejected for Solana. We do NOT rely on string length or a
// loose regular expression alone — we decode and check the byte length.
//
// Ethereum + Base: must be a valid EVM address (0x + exactly 40 hex chars).
// Ethereum and Base share the same EVM address format; the address itself
// cannot distinguish between those two networks.

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export const NETWORKS = ["ethereum", "base", "solana"] as const;

export interface ValidationResult {
  ok: boolean;
  code?: string;
  chain?: string;
  message?: string;
  suggestedChain?: string;
}

// Precompute the Base58 character → index lookup map.
const BASE58_LOOKUP: Record<string, number> = {};
for (let i = 0; i < BASE58_ALPHABET.length; i++) {
  BASE58_LOOKUP[BASE58_ALPHABET[i]] = i;
}

// Decode a Base58 string to a byte array. Returns null on any invalid character.
// Uses BigInt so it handles the full 32-byte (256-bit) Solana address range
// without floating-point precision loss.
export function decodeBase58(str: string): Uint8Array | null {
  if (!str || typeof str !== "string") return null;

  // Count leading '1' characters (they encode to leading zero bytes).
  let zeros = 0;
  while (zeros < str.length && str[zeros] === "1") zeros++;

  // Convert to a BigInt, accumulating base-58.
  let num = 0n;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    const val = BASE58_LOOKUP[c];
    if (val === undefined) return null; // invalid character
    num = num * 58n + BigInt(val);
  }

  // Convert the BigInt to bytes.
  let hex = num.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const bodyLen = hex.length / 2;
  const bytes = new Uint8Array(zeros + bodyLen);
  for (let i = 0; i < bodyLen; i++) {
    bytes[zeros + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  return bytes;
}

// Check if an address is a valid Solana address: Base58 character set AND
// decodes to exactly 32 bytes. An EVM-style 0x… address is always rejected.
export function isValidSolanaAddress(address: string): boolean {
  if (!address || typeof address !== "string") return false;
  const a = address.trim();
  if (!a) return false;
  // Quick character-set guard before the heavier decode.
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(a)) return false;
  const decoded = decodeBase58(a);
  if (!decoded) return false;
  return decoded.length === 32;
}

// Check if an address is a valid EVM address: starts with 0x followed by
// exactly 40 hexadecimal characters.
export function isValidEvmAddress(address: string): boolean {
  if (!address || typeof address !== "string") return false;
  const a = address.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(a);
}

// Detect the chain family from an address's format.
// Returns "evm" for 0x… addresses, "solana" for valid Base58/32-byte addresses,
// or "unknown" for anything else.
export function detectChainFamily(address: string): "evm" | "solana" | "unknown" {
  if (!address || typeof address !== "string") return "unknown";
  const a = address.trim();
  if (!a) return "unknown";
  if (/^0x[a-fA-F0-9]{40}$/.test(a)) return "evm";
  if (isValidSolanaAddress(a)) return "solana";
  return "unknown";
}

// Validate a wallet address for a specific chain. Returns a structured result
// with a code, chain, user-facing message, and suggested compatible chain
// family when the mismatch can be inferred.
export function validateWalletForChain(network: string, address: string): ValidationResult {
  if (!network || !NETWORKS.includes(network as any)) {
    return {
      ok: false,
      code: "UNSUPPORTED_CHAIN",
      chain: network || null,
      message: "The selected network is not supported.",
    };
  }

  if (!address || typeof address !== "string" || !address.trim()) {
    return {
      ok: false,
      code: "MISSING_ADDRESS",
      chain: network,
      message: "A wallet address is required.",
    };
  }

  const a = address.trim();

  if (network === "solana") {
    if (isValidSolanaAddress(a)) {
      return { ok: true, chain: network };
    }
    // Determine the suggested chain family for a helpful message.
    if (/^0x[a-fA-F0-9]{40}$/.test(a)) {
      return {
        ok: false,
        code: "INVALID_WALLET_FOR_CHAIN",
        chain: network,
        message: "This looks like an Ethereum/Base address, but Solana is selected. Switch networks and try again.",
        suggestedChain: "ethereum",
      };
    }
    return {
      ok: false,
      code: "INVALID_WALLET_FOR_CHAIN",
      chain: network,
      message: "That does not look like a valid Solana address. Solana addresses are base58, 32–44 characters.",
    };
  }

  // ethereum + base share the EVM format
  if (network === "ethereum" || network === "base") {
    if (isValidEvmAddress(a)) {
      return { ok: true, chain: network };
    }
    if (isValidSolanaAddress(a)) {
      return {
        ok: false,
        code: "INVALID_WALLET_FOR_CHAIN",
        chain: network,
        message: `This looks like a Solana address, but ${network === "ethereum" ? "Ethereum" : "Base"} is selected. Switch networks and try again.`,
        suggestedChain: "solana",
      };
    }
    return {
      ok: false,
      code: "INVALID_WALLET_FOR_CHAIN",
      chain: network,
      message: "That does not look like a valid Ethereum/Base address. It must start with 0x followed by 40 hexadecimal characters.",
    };
  }

  return {
    ok: false,
    code: "UNSUPPORTED_CHAIN",
    chain: network,
    message: "The selected network is not supported.",
  };
}