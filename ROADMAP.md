# Roadmap

## v1 — Launch (Base44 Dejunk)

- [ ] Monorepo scaffold
- [ ] Landing page
- [ ] Upload form with drag-drop zip
- [ ] `@base44ripper/detect` — scan Base44 export, emit detection report
- [ ] `@base44ripper/codemods-base44` — deterministic transforms
  - [ ] Strip `@base44/sdk` + `@base44/vite-plugin` from `package.json`
  - [ ] Rewrite `vite.config.js` to drop the `base44()` plugin
  - [ ] Replace `src/api/base44Client.js` stub with real client
  - [ ] Generate `localDb.js` shim from `entities/*/schema.json`
  - [ ] Rewrite `src/lib/app-params.js` to use Vite env vars
  - [ ] Rewrite `README.md` and `index.html` to drop Base44 branding
- [ ] `@base44ripper/shim-lib-localDb` — runtime shim injected into customer repos (Quick Eject tier)
- [ ] Supabase tier: bundle Ai-Automators SDK + generate Supabase schema SQL from `entities/*/schema.json`
- [ ] Pipeline worker (queue, R2, Resend email delivery)
- [ ] Stripe Checkout + paywalled download
- [ ] Policy pages (ToS, privacy), analytics, pricing page

## v2 — Retention + Breadth

- [ ] Hosting reseller: Fly Machines API, provisioned per-user with markup-undercut pricing
- [ ] In-browser editor: Monaco + StackBlitz WebContainers, with scoped "ask AI to change this" box
- [ ] AI-assisted refactor tier (human-reviewed LLM diffs) for messy codebases
- [ ] Extractor extensions for platforms that don't already have a third-party extractor:
  - Lovable.dev
  - Bolt.new (StackBlitz)
  - v0.dev
  - Create.xyz / Wix Studio AI / Framer AI
- [ ] One-click GitHub push (OAuth → create repo → push output)

## v3 — AI Employees for Websites (post-launch pivot / extension)

Once we have a userbase of ejected, customer-owned apps, layer on "hire an AI employee" as an add-on to their deployed site:

- [ ] Customer support agent (chat widget, ticket handling, knowledge-base-grounded)
- [ ] Outbound sales / outreach agent (email + LinkedIn drafts, follow-up scheduling)
- [ ] Data acquisition agent (scrape + enrich + dedupe lead lists per brief)
- [ ] Market analysis agent (competitor monitoring, pricing dashboards, weekly brief)
- [ ] Meeting agent (join calls, transcribe, action-item extraction, CRM push)

Each is a thin SaaS wrapper around existing LLM + automation primitives, scoped to the customer's ejected app. Strong distribution tailwind because the customer already trusts us with their codebase.
