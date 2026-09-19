// Reown AppKit EVM wallet connection.
//
// The Reown Project ID is a PUBLIC client identifier (not a secret key), so it
// is safe to bundle in client code. Base44 Secrets are backend-only and are
// NOT available to Vite client bundles, so the ID is centralized here rather
// than read from import.meta.env. A VITE_REOWN_PROJECT_ID env var, if present,
// overrides the bundled ID for local development.
//
// If AppKit initialization fails at runtime, `reownReady` is false and the claim
// UI shows a generic "temporarily unavailable" message. The technical reason is
// logged to the browser console for the admin/developer — never exposed to
// visitors, and never mentioning environment-variable names.
import { createAppKit } from "@reown/appkit/react";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";
import { mainnet, base } from "@reown/appkit/networks";

// Public Reown Project ID for Wallet Court. Safe to ship in client bundles.
const PUBLIC_REOWN_PROJECT_ID = "84029e45a791343d8220495940aea18f";

export const REOWN_PROJECT_ID =
  (import.meta.env && import.meta.env.VITE_REOWN_PROJECT_ID) ||
  PUBLIC_REOWN_PROJECT_ID;

export const reownConfigured = Boolean(REOWN_PROJECT_ID);

// Whether AppKit initialized successfully. Evaluated synchronously at module
// load. Components read this to decide whether to render the claim UI or the
// fallback "temporarily unavailable" message.
let _reownReady = false;
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
  _reownReady = true;
} catch (e) {
  // Log privately for the admin/developer. Never surface this to visitors.
  console.error("Reown AppKit initialization failed:", e);
}
export const reownReady = _reownReady;