# Wallet Court

[Try Wallet Court](https://court.shoutit.world/) — a ShoutIt Original powered by Nansen data. Enter a public wallet address to put its onchain history on trial. Nansen evidence drives a verdict and a shareable Court Receipt.

## Meridian Buildathon demo

Choose Ethereum, Base, or Solana on the homepage and submit a public wallet address with recent onchain activity. A live analysis fetches Nansen Profiler PnL summary and DEX trades, plus current balances and transaction history when available. Wallet Court turns those results into evidence, metrics, and a verdict. A successful case can be opened at its public `/case/{slug}` link and shared as a Court Receipt. Public Robinhood access is controlled by a feature flag; the demo should use one of the other supported networks unless that flag is enabled.

The backend flow is `src/pages/Home.jsx` → `base44/functions/analyzeWalletWithNansen/entry.ts` → `base44/shared/nansen.ts` → evidence sufficiency and verdict selection in `base44/shared/`. The Nansen API key is read only by server code from the Base44 secret `NANSEN_API_KEY`; it is not included in this repository or exposed to browsers.

The verdict uses Nansen data rather than a fixed script: realized PnL, trading activity and other available evidence influence the selected verdict, its severity, confidence, and supporting facts. If there is not enough evidence, the app can return a dismissal or mistrial; provider errors trigger a Court Recess without inventing a live verdict. The deterministic demo wallet path is marked `data_mode=demo` and makes no Nansen calls. For Meridian judging, record a **live** wallet analysis and a public case, not a demo case.

To follow the build locally, use the Base44 setup below, link the app, and configure `NANSEN_API_KEY` in the backend secret store for live calls. Run `npm run test` and `npm run build` to verify the frontend and backend logic. The hosted demo works at the URL above.

## Submission status

Nansen requires a public GitHub repository, a 30–60 second X recording showing a working live Nansen flow with `@nansen_ai` and the GitHub link, and the [Meridian entry form](https://nansen-ai.typeform.com/meridian-submit) with email, X URL and GitHub URL. The public GitHub URL and the X post URL must be supplied when available; the Base44 internal sandbox remote is not a public repository.

## Base44 Project

Use this repository to run and edit the app locally, then publish changes back through Base44.

Any change pushed to the repo will also be reflected in the Base44 Builder.

## Prerequisites

1. Clone the repository using the project's Git URL.
2. Navigate to the project directory.
3. Install dependencies: `npm install`.
4. Install the Base44 CLI: `npm install -g base44@latest`.
5. Install [Deno](https://docs.deno.com/runtime/getting_started/installation/) — the local Base44 backend runs on it.

Run `base44 --help` (or see the [CLI reference](https://docs.base44.com/developers/references/cli/commands/introduction)) for the full command surface.

## Run Locally

Three commands, from the project root:

```bash
base44 login   # one-time per machine
base44 link    # one-time per clone
base44 dev     # local backend + frontend together
```

Open the frontend URL that `base44 dev` prints (typically `http://localhost:5173`).

Notes:

- **Every fresh clone needs `base44 link`.** It writes `base44/.app.jsonc` (the app-id pointer), which is deliberately gitignored. Your app id is in the Builder URL (`app.base44.com/apps/<id>/...`); `base44 link --help` shows the non-interactive flags.
- **`base44 dev` runs the frontend for you** (via `site.serveCommand` in this repo's `base44/config.jsonc`) — never run `npm run dev` yourself: alone it serves a UI with no backend behind it (`[base44] Proxy not enabled`, every `/api` call fails), and alongside `base44 dev` the second Vite silently takes the next port and you end up looking at the wrong one.
- **The app must be published at least once for the UI to load under `base44 dev`.** The frontend boots by fetching app settings from the hosted app; before the first publish that fails and every page redirects to login. The local API works regardless.
- Entities, functions, and auth run locally — entity data is **in-memory only**, wiped when `base44 dev` restarts. Everything else (Core integrations, OAuth login) is forwarded to your deployed app. Full breakdown: [Local development overview](https://docs.base44.com/developers/backend/overview/local-dev/local-development-overview).

## Frontend Only, Hosted Backend

To work on just the frontend against your app's live hosted backend:

```bash
base44 dev --remote
```

⚠️ In this mode writes go to your app's **production data** — plain `base44 dev` keeps everything local.

## Publish Your Changes

After pushing your changes to git, open the Base44 dashboard and publish the app:

```bash
base44 dashboard open
```

This repo syncs to Base44 through git, so publish from the dashboard rather than `base44 deploy` — a CLI deploy ships your local tree directly, bypassing the sync, and the deployed state silently diverges from the repo.

## Docs & Support

GitHub integration: [https://docs.base44.com/developers/app-code/local-development/github](https://docs.base44.com/developers/app-code/local-development/github)

Local development: [https://docs.base44.com/developers/backend/overview/local-dev/local-development-overview](https://docs.base44.com/developers/backend/overview/local-dev/local-development-overview)

Support: [https://app.base44.com/support](https://app.base44.com/support)
