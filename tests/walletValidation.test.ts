// Chain-specific wallet validation tests. Pure: imports only
// walletValidation.ts. Proves valid combinations succeed, invalid
// combinations are rejected, Solana addresses are decoded to 32 bytes
// (not just string-length checked), and EVM addresses on Solana are
// always rejected.
import { describe, it, expect } from "vitest";
import {
  validateWalletForChain,
  isValidSolanaAddress,
  isValidEvmAddress,
  detectChainFamily,
  decodeBase58,
  NETWORKS,
} from "../base44/shared/walletValidation.ts";

// Real, well-known addresses for fixtures.
const VALID_EVM = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const VALID_SOLANA = "7Np41oeYqPehNQvckV3EW9Z99Hq2k1tN5x2sV5dQFJQ";
const ANOTHER_SOLANA = "DJVEYj8k3dVJhNzJ5g5d1m3kQx4vJ8cF2bN6sH9tR1kZ";
const EVM_SHORT = "0x1234";
const EVM_BAD_HEX = "0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG";
const SOLANA_TOO_SHORT = "1"; // valid base58 but decodes to 0 bytes

describe("wallet validation — valid Solana address + Solana succeeds", () => {
  it("accepts a real Solana address for Solana network", () => {
    const r = validateWalletForChain("solana", VALID_SOLANA);
    expect(r.ok).toBe(true);
    expect(r.code).toBeUndefined();
  });

  it("accepts another valid Solana address", () => {
    const r = validateWalletForChain("solana", ANOTHER_SOLANA);
    expect(r.ok).toBe(true);
  });
});

describe("wallet validation — EVM address + Solana is rejected", () => {
  it("rejects a 0x address for Solana with INVALID_WALLET_FOR_CHAIN", () => {
    const r = validateWalletForChain("solana", VALID_EVM);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVALID_WALLET_FOR_CHAIN");
    expect(r.suggestedChain).toBe("ethereum");
    expect(r.message).toContain("Solana");
  });

  it("rejects a 0x address even if it looks valid for EVM", () => {
    const r = validateWalletForChain("solana", "0x742d35Cc6634C0532925a3b844Bc454e4438f44e");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVALID_WALLET_FOR_CHAIN");
  });
});

describe("wallet validation — malformed Base58 + Solana is rejected", () => {
  it("rejects a string with invalid base58 characters (0, O, l, I)", () => {
    const r = validateWalletForChain("solana", "0OIl1234567890abcdefghijklmnopqrstuvwxyz");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVALID_WALLET_FOR_CHAIN");
  });

  it("rejects a string with spaces and special characters", () => {
    const r = validateWalletForChain("solana", "7Np41oeYqPehNQvckV3EW9Z99Hq2k1tN5x2sV5dQFJQ!");
    expect(r.ok).toBe(false);
  });
});

describe("wallet validation — incorrect decoded Solana byte length is rejected", () => {
  it("rejects a valid base58 string that decodes to 0 bytes", () => {
    const r = validateWalletForChain("solana", SOLANA_TOO_SHORT);
    expect(r.ok).toBe(false);
  });

  it("rejects a valid base58 string that decodes to fewer than 32 bytes", () => {
    // "AB" is valid base58 (A=9, B=10) but decodes to only 2 bytes, not 32.
    const r = validateWalletForChain("solana", "AB");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVALID_WALLET_FOR_CHAIN");
  });

  it("rejects a medium-length base58 string that decodes to fewer than 32 bytes", () => {
    // "1234567890abcdefghij" (20 chars) decodes to far fewer than 32 bytes.
    const r = validateWalletForChain("solana", "1234567890abcdefghij");
    expect(r.ok).toBe(false);
  });

  it("decodeBase58 returns the correct byte length for a real Solana address", () => {
    const decoded = decodeBase58(VALID_SOLANA);
    expect(decoded).not.toBeNull();
    expect(decoded.length).toBe(32);
  });
});

describe("wallet validation — valid EVM address + Ethereum succeeds", () => {
  it("accepts a real EVM address for Ethereum", () => {
    const r = validateWalletForChain("ethereum", VALID_EVM);
    expect(r.ok).toBe(true);
  });

  it("accepts a lowercase EVM address", () => {
    const r = validateWalletForChain("ethereum", "0x742d35cc6634c0532925a3b844bc454e4438f44e");
    expect(r.ok).toBe(true);
  });

  it("accepts an uppercase EVM address", () => {
    const r = validateWalletForChain("ethereum", "0x742D35CC6634C0532925A3B844BC454E4438F44E");
    expect(r.ok).toBe(true);
  });
});

describe("wallet validation — valid EVM address + Base succeeds", () => {
  it("accepts a real EVM address for Base", () => {
    const r = validateWalletForChain("base", VALID_EVM);
    expect(r.ok).toBe(true);
  });
});

describe("wallet validation — Solana address + Ethereum is rejected", () => {
  it("rejects a Solana address for Ethereum with INVALID_WALLET_FOR_CHAIN", () => {
    const r = validateWalletForChain("ethereum", VALID_SOLANA);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVALID_WALLET_FOR_CHAIN");
    expect(r.suggestedChain).toBe("solana");
    expect(r.message).toContain("Ethereum");
  });
});

describe("wallet validation — Solana address + Base is rejected", () => {
  it("rejects a Solana address for Base with INVALID_WALLET_FOR_CHAIN", () => {
    const r = validateWalletForChain("base", VALID_SOLANA);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVALID_WALLET_FOR_CHAIN");
    expect(r.suggestedChain).toBe("solana");
    expect(r.message).toContain("Base");
  });
});

describe("wallet validation — malformed 0x address is rejected", () => {
  it("rejects a too-short 0x address", () => {
    const r = validateWalletForChain("ethereum", EVM_SHORT);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVALID_WALLET_FOR_CHAIN");
  });

  it("rejects a 0x address with non-hex characters", () => {
    const r = validateWalletForChain("ethereum", EVM_BAD_HEX);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVALID_WALLET_FOR_CHAIN");
  });

  it("rejects an address without 0x prefix", () => {
    const r = validateWalletForChain("ethereum", "742d35Cc6634C0532925a3b844Bc454e4438f44e");
    expect(r.ok).toBe(false);
  });
});

describe("wallet validation — missing/unsupported chain is rejected", () => {
  it("rejects an unsupported chain", () => {
    const r = validateWalletForChain("bitcoin", VALID_EVM);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("UNSUPPORTED_CHAIN");
  });

  it("rejects a null chain", () => {
    const r = validateWalletForChain(null, VALID_EVM);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("UNSUPPORTED_CHAIN");
  });

  it("rejects an empty chain", () => {
    const r = validateWalletForChain("", VALID_EVM);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("UNSUPPORTED_CHAIN");
  });

  it("rejects a missing address", () => {
    const r = validateWalletForChain("ethereum", "");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("MISSING_ADDRESS");
  });
});

describe("wallet validation — detectChainFamily", () => {
  it("detects EVM family for 0x addresses", () => {
    expect(detectChainFamily(VALID_EVM)).toBe("evm");
  });

  it("detects Solana family for valid Solana addresses", () => {
    expect(detectChainFamily(VALID_SOLANA)).toBe("solana");
  });

  it("returns unknown for garbage", () => {
    expect(detectChainFamily("not an address")).toBe("unknown");
    expect(detectChainFamily("")).toBe("unknown");
  });
});

describe("wallet validation — NETWORKS list", () => {
  it("contains ethereum, base, solana", () => {
    expect(NETWORKS).toContain("ethereum");
    expect(NETWORKS).toContain("base");
    expect(NETWORKS).toContain("solana");
  });
});