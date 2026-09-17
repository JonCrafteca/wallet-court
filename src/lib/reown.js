// Reown AppKit EVM wallet connection. Configured from VITE_REOWN_PROJECT_ID.
// If the project id is missing, AppKit is not initialized and the claim UI
// shows a clear setup-disabled state — the rest of Wallet Court keeps working.
import { createAppKit } from "@reown/appkit/react";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";
import { mainnet, base } from "@reown/appkit/networks";

export const REOWN_PROJECT_ID =
  (import.meta.env && import.meta.env.VITE_REOWN_PROJECT_ID) || "";

export const reownConfigured = Boolean(REOWN_PROJECT_ID);

let initialized = false;
export function ensureReown() {
  if (initialized || !reownConfigured) return;
  initialized = true;
  try {
    createAppKit({
      adapters: [new EthersAdapter()],
      networks: [mainnet, base],
      projectId: REOWN_PROJECT_ID,
      metadata: {
        name: "Wallet Court",
        description: "Put your wallet on trial.",
        url: typeof window !== "undefined" ? window.location.origin : "https://walletcourt.app",
        icons: []
      },
      features: { analytics: false }
    });
  } catch {
    // A bad/missing project id should never crash the site. The claim UI guards
    // on connection state, so a failed init just leaves the modal unavailable.
  }
}

ensureReown();