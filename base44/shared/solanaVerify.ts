// Wallet Court — Solana Ed25519 signature verification. Pure, no platform
// runtime dependency. Uses the Web Crypto API (crypto.subtle) which is a
// global available in both the Base44 backend (Deno) and the test environment
// (Node.js 16+). No npm import required.
//
// Solana wallets sign raw UTF-8 message bytes with Ed25519. The public key
// IS the Solana address (32 bytes, base58-encoded). The signature is 64 bytes,
// typically base58-encoded (Solana standard) or base64.

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Decode(str) {
  if (!str || typeof str !== "string") return null;
  const BASE = BigInt(58);
  let num = BigInt(0);
  for (const c of str) {
    const idx = BASE58_ALPHABET.indexOf(c);
    if (idx === -1) return null;
    num = num * BASE + BigInt(idx);
  }
  const bytes = [];
  let n = num;
  while (n > 0n) {
    bytes.push(Number(n & 0xffn));
    n = n >> 8n;
  }
  bytes.reverse();
  // Leading '1' characters encode as leading zero bytes.
  let i = 0;
  while (i < str.length && str[i] === "1") {
    bytes.unshift(0);
    i++;
  }
  return new Uint8Array(bytes);
}

export function base58Encode(bytes) {
  if (!bytes || bytes.length === 0) return "";
  const BASE = BigInt(58);
  let num = BigInt(0);
  for (const b of bytes) {
    num = (num << 8n) + BigInt(b);
  }
  let str = "";
  while (num > 0n) {
    str = BASE58_ALPHABET[Number(num % BASE)] + str;
    num = num / BASE;
  }
  // Leading zero bytes encode as leading '1' characters.
  for (const b of bytes) {
    if (b === 0) str = "1" + str;
    else break;
  }
  return str;
}

function base64Decode(str) {
  try {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

// Verify an Ed25519 detached signature for a Solana wallet.
//   message         — the exact string the wallet signed (UTF-8 encoded)
//   signatureEncoded — base58 or base64 encoded 64-byte signature
//   publicKeyBase58  — base58 encoded 32-byte Ed25519 public key (the Solana address)
// Returns true only if the signature is cryptographically valid for this
// message and public key. Never throws — returns false on any error.
export async function verifySolanaSignature(
  message,
  signatureEncoded,
  publicKeyBase58
) {
  if (!message || !signatureEncoded || !publicKeyBase58) return false;

  const pubKeyBytes = base58Decode(publicKeyBase58);
  if (!pubKeyBytes || pubKeyBytes.length !== 32) return false;

  // Try base58 first (Solana standard), then base64 fallback.
  let sigBytes = base58Decode(signatureEncoded);
  if (!sigBytes || sigBytes.length !== 64) {
    sigBytes = base64Decode(signatureEncoded);
  }
  if (!sigBytes || sigBytes.length !== 64) return false;

  const msgBytes = new TextEncoder().encode(message);

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      pubKeyBytes,
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      sigBytes,
      msgBytes
    );
  } catch {
    return false;
  }
}