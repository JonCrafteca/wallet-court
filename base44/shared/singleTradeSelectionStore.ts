// Wallet Court — Single Trade Trial purchase selection store. Server-side
// only. Uses base44.asServiceRole to create/consume SingleTradePurchaseSelection
// records. Imported by backend functions; never imported by client code.
//
// The browser NEVER receives the transaction_hash, wallet address, or mint
// from discovery. It receives only an opaque selection_id plus sanitized
// display data (timestamp, cost, mcap, symbol, tx_hash_short). The
// analyzeSingleTrade function resolves the authoritative purchase server-side
// by looking up the selection_id and atomically consuming it via CAS.

const ENTITY = "SingleTradePurchaseSelection";

export const SELECTION_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

export function newSelectionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return "sel_" + crypto.randomUUID();
  }
  return "sel_" + Math.random().toString(36).slice(2, 14) + Date.now().toString(36);
}

// Create a purchase selection record. Stores the full authoritative purchase
// data server-side. Returns the record (including the opaque selection_id).
export async function createSelection(base44, fields: Record<string, any>): Promise<any> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SELECTION_EXPIRY_MS).toISOString();
  return base44.asServiceRole.entities[ENTITY].create({
    selection_id: fields.selection_id || newSelectionId(),
    normalized_wallet_address: fields.normalized_wallet_address,
    network: fields.network,
    token_mint: fields.token_mint,
    transaction_hash: fields.transaction_hash,
    purchase_timestamp: fields.purchase_timestamp || null,
    purchase_cost_usd: fields.purchase_cost_usd ?? null,
    tokens_received: fields.tokens_received ?? null,
    entry_market_cap_usd: fields.entry_market_cap_usd ?? null,
    entry_price_usd: fields.entry_price_usd ?? null,
    token_symbol: fields.token_symbol || null,
    expires_at: fields.expires_at || expiresAt,
    consumed_at: null,
    consumed_by_trial_id: null,
    version: 0,
    created_at: now
  });
}

// Find a selection by its opaque selection_id. Returns null if not found.
export async function findSelection(base44, selectionId: string): Promise<any | null> {
  const records = await base44.asServiceRole.entities[ENTITY].filter(
    { selection_id: selectionId }, "-created_date", 1
  );
  return (records && records[0]) || null;
}

// Atomically consume a selection via CAS. The selection must:
//   - exist
//   - not be expired
//   - not be already consumed
//   - match the expected wallet and mint
//
// Returns { consumed, selection, reason }. When consumed=true, the caller
// has exclusive ownership of this selection and may proceed with analysis.
// When consumed=false, the selection was rejected for the given reason.
export async function consumeSelection(base44, selectionId: string, expectedWallet: string, expectedMint: string): Promise<{ consumed: boolean; selection: any | null; reason: string }> {
  const selection = await findSelection(base44, selectionId);
  if (!selection) {
    return { consumed: false, selection: null, reason: "Selection not found. Please rediscover purchases and try again." };
  }

  // Already consumed?
  if (selection.consumed_at) {
    return { consumed: false, selection, reason: "This purchase selection has already been used for an analysis." };
  }

  // Expired?
  const now = Date.now();
  const expiresAt = selection.expires_at ? new Date(selection.expires_at).getTime() : 0;
  if (expiresAt && now > expiresAt) {
    return { consumed: false, selection, reason: "This purchase selection has expired. Please rediscover purchases and try again." };
  }

  // Wallet mismatch?
  if (selection.normalized_wallet_address !== expectedWallet) {
    return { consumed: false, selection, reason: "Wallet address does not match the discovery request." };
  }

  // Mint mismatch?
  const selMint = (selection.token_mint || "").toLowerCase();
  const expMint = (expectedMint || "").toLowerCase();
  if (selMint !== expMint) {
    return { consumed: false, selection, reason: "Token mint does not match the discovery request." };
  }

  // CAS consume: version guard + consumed_at: null.
  const nowIso = new Date().toISOString();
  const result = await base44.asServiceRole.entities[ENTITY].updateMany(
    {
      selection_id: selectionId,
      version: selection.version,
      consumed_at: null
    },
    {
      $set: {
        consumed_at: nowIso
      },
      $inc: { version: 1 }
    }
  );

  if (!result || result.updated !== 1) {
    // CAS failed — another concurrent analysis consumed it, or the version
    // changed. Re-read to determine the reason.
    const refreshed = await findSelection(base44, selectionId);
    if (refreshed && refreshed.consumed_at) {
      return { consumed: false, selection: refreshed, reason: "This purchase selection was just consumed by another analysis." };
    }
    return { consumed: false, selection: refreshed, reason: "Selection could not be consumed (concurrent modification). Please try again." };
  }

  // Consume succeeded. Return the selection (re-read for the updated state).
  const updated = await findSelection(base44, selectionId);
  return { consumed: true, selection: updated, reason: "" };
}

// Link a consumed selection to the trial that won the analysis. Called
// after the trial is created. Does NOT swallow errors — a failure here
// leaves the selection ambiguously consumed with consumed_by_trial_id=null,
// which the caller must handle (retry the link or fail the trial).
export async function linkSelectionToTrial(base44, selectionId: string, trialId: string): Promise<void> {
  const selection = await findSelection(base44, selectionId);
  if (!selection) return;
  await base44.asServiceRole.entities[ENTITY].update(selection.id, {
    consumed_by_trial_id: trialId
  });
}