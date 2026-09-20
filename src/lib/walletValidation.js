// Client-side mirror of base44/shared/walletValidation.ts. Provides immediate
// frontend validation feedback before the request is sent. The backend
// (analyzeWalletWithNansen) is authoritative — this mirror must stay in sync.

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export const NETWORKS = ["ethereum", "base", "solana"];

const BASE58_LOOKUP = {};
for (let i = 0; i < BASE58_ALPHABET.length; i++) {
  BASE58_LOOKUP[BASE58_ALPHABET[i]] = i;
}

export function decodeBase58(str) {
  if (!str || typeof str !== "string") return null;
  let zeros = 0;
  while (zeros < str.length && str[zeros] === "1") zeros++;
  let num = 0n;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    const val = BASE58_LOOKUP[c];
    if (val === undefined) return null;
    num = num * 58n + BigInt(val);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const bodyLen = hex.length / 2;
  const bytes = new Uint8Array(zeros + bodyLen);
  for (let i = 0; i < bodyLen; i++) {
    bytes[zeros + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function isValidSolanaAddress(address) {
  if (!address || typeof address !== "string") return false;
  const a = address.trim();
  if (!a) return false;
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(a)) return false;
  const decoded = decodeBase58(a);
  if (!decoded) return false;
  return decoded.length === 32;
}

export function isValidEvmAddress(address) {
  if (!address || typeof address !== "string") return false;
  const a = address.trim();
  return /^0x[a-fA-F0-9]{40}$/.test(a);
}

export function detectChainFamily(address) {
  if (!address || typeof address !== "string") return "unknown";
  const a = address.trim();
  if (!a) return "unknown";
  if (/^0x[a-fA-F0-9]{40}$/.test(a)) return "evm";
  if (isValidSolanaAddress(a)) return "solana";
  return "unknown";
}

export function validateWalletForChain(network, address) {
  if (!network || !NETWORKS.includes(network)) {
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