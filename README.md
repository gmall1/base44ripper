# base44ripper

**One-click escape from vibe-code platform lock-in.**

Upload the zip your vibe-code platform gave you. Get back a clean, runnable repo you own forever. Pay once, run anywhere.

## What this does

Vibe-code platforms (Base44, Lovable, Bolt.new, v0, Replit Agent, etc.) are great for getting an app off the ground — but they leave you locked in. Their "export" buttons produce code that either doesn't run at all, or silently no-ops every backend call.

base44ripper fixes that. We run a deterministic pipeline over your export that:

1. Strips the platform SDKs and build plugins
2. Regenerates `vite.config.js` / `next.config.js` without their hooks
3. Swaps the dead no-op clients for a real backend — either a local `localStorage`-backed shim (for single-user apps) or a Supabase-backed SDK (for multi-user apps)
4. Generates a proper `README.md`, `.env.example`, and quickstart
5. Hands you a zip or pushes to a fresh GitHub repo

## Pricing (at launch)

| Tier | Price | What you get |
|---|---|---|
| **Quick Eject** | ~$15 one-time | localStorage shim, works for single-user offline apps, fully automated |
| **Supabase Eject** | ~$39 one-time | Supabase-backed SDK, real auth + realtime + multi-user, you bring your own Supabase project |
| **Managed** | ~$49/mo | We provision Supabase + host the app + give you the in-browser editor |

## Status

**Pre-alpha.** Currently supports Base44 exports. Lovable / Bolt / v0 / Replit adapters planned for v2.

## Monorepo layout

```
base44ripper/
├── apps/
│   └── web/                     # next.js: landing, upload, checkout, download
├── packages/
│   ├── detect/                  # scan a zip → emit a detection report
│   ├── codemods/
│   │   └── base44/              # pure codemods that transform a Base44 export → clean repo
│   ├── shim-lib/
│   │   └── localDb/             # localStorage-backed entity store (schema-driven)
│   └── ui/                      # shadcn components shared across apps
└── workers/
    └── pipeline/                # queue worker: fetch zip → run codemods → upload result
```

## Development

```bash
pnpm install
pnpm dev            # start next.js dev server for the web app
pnpm -r test        # run all package test suites
pnpm -r lint
```

## Attribution

The Supabase-backed tier bundles (with attribution) the excellent MIT-licensed SDK from [Ai-Automators/base44-to-supabase-sdk](https://github.com/Ai-Automators/base44-to-supabase-sdk), which provides a universal drop-in `base44Client.js` replacement backed by Supabase.

## License

MIT
