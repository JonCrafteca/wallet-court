// Frontend Solana wallet connection and message signing.
// Uses direct browser injection (window.solana) — supports Phantom and other
// Solana wallets that follow the window.solana injection convention.
// No npm packages required; the backend verifies signatures with crypto.subtle.

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

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
  for (const b of bytes) {
    if (b === 0) str = "1" + str;
    else break;
  }
  return str;
}

export function isSolanaWalletAvailable() {
  return typeof window !== "undefined" && !!window.solana && typeof window.solana.connect === "function";
}

// Connect to the injected Solana wallet (Phantom, Solflare, etc.).
// Returns the base58-encoded public key (the Solana address).
export async function connectSolana() {
  if (!isSolanaWalletAvailable()) {
    throw new Error("Solana wallet not found. Install Phantom or another Solana wallet extension.");
  }
  const response = await window.solana.connect();
  // Phantom returns { publicKey: PublicKey }. PublicKey.toString() is base58.
  return response.publicKey.toString();
}

// Sign a UTF-8 message with the connected Solana wallet.
// Returns the base58-encoded 64-byte Ed25519 signature.
// Never requests a transaction, token approval, or seed phrase.
export async function signSolanaMessage(message) {
  if (!isSolanaWalletAvailable()) {
    throw new Error("Solana wallet not found.");
  }
  const encoded = new TextEncoder().encode(message);
  const { signature } = await window.solana.signMessage(encoded, "utf8");
  return base58Encode(signature);
}