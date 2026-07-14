# edge/terminal

A mobile-first crypto trading edge tool. Dense, dark, information-forward —
built to feel like a trading terminal in your pocket, not a landing page.

**Stack:** React 19 · Vite · TypeScript · Tailwind v4 · Postgres (Neon/Supabase)
· Vercel serverless functions.

Designed for a **390px viewport first** and scaled up from there.

## Quick start

```bash
npm install
cp .env.example .env.local      # then fill in DATABASE_URL
npm run dev                     # http://localhost:5173
```

The app runs without a database — the health indicator in the header just shows
`down` until `DATABASE_URL` is set and the API is running.

### Running the API locally

The `/api` routes are Vercel serverless functions. To exercise them locally,
run the Vercel dev server alongside Vite (Vite proxies `/api` → `:3000`):

```bash
npm i -g vercel          # one time
vercel dev               # serves /api on :3000
npm run dev              # in a second terminal
```

Check wiring: open the app and watch the `api ●` dot in the header, or
`curl localhost:3000/api/health`.

## Environment variables

| Var            | Required | What it is |
| -------------- | -------- | ---------- |
| `DATABASE_URL` | yes (for DB features) | Postgres connection string from Neon or Supabase |

- `.env.example` — committed template, no secrets.
- `.env.local` — your real values, **git-ignored, never committed**.
- On Vercel: set the same keys under **Project → Settings → Environment Variables**.

### Getting a database (free tier)

- **Neon:** [neon.tech](https://neon.tech) → new project → copy the pooled
  connection string. Works with the `@neondatabase/serverless` driver used here.
- **Supabase:** [supabase.com](https://supabase.com) → Project → Settings →
  Database → Connection string (URI).

## Project structure

```
├── api/                 # Vercel serverless functions (Node)
│   ├── _db.ts           # shared Postgres client (Neon serverless driver)
│   └── health.ts        # GET /api/health — liveness + DB check
├── src/
│   ├── components/      # UI components (Panel, Stat, TokenRow, …)
│   ├── lib/             # client helpers (api client, formatters, types)
│   ├── App.tsx          # app shell: header, feed, bottom nav
│   ├── main.tsx         # React entry
│   └── index.css        # Tailwind v4 + design tokens (@theme)
├── .env.example         # committed env template
├── vercel.json          # Vercel build config
└── vite.config.ts       # Vite + /api dev proxy
```

## Design system

Tokens live in `src/index.css` under `@theme` and are available as Tailwind
utilities:

| Token            | Value     | Use |
| ---------------- | --------- | --- |
| `base`           | `#0a0a0a` | page background (near-black) |
| `panel`/`panel-2`| `#101010`/`#161616` | raised / nested surfaces |
| `line`/`line-2`  | `#1f1f1f`/`#2a2a2a` | borders |
| `lime`           | `#a3e635` | primary accent |
| `up`/`down`      | lime/`#f87171` | gains / losses |
| `ink*`           | greys     | text hierarchy |

Fonts: **Inter** (sans) and **JetBrains Mono** (labels, numbers). Corners stay
tight (2–4px) — this is a tool, not SaaS marketing.

## Deploy (Vercel)

1. Push this repo to GitHub.
2. On Vercel: **New Project → import the repo**. Framework auto-detects as Vite.
3. Add `DATABASE_URL` under Environment Variables.
4. Deploy. `/api/*` become serverless functions automatically.

## Scripts

| Command           | What it does |
| ----------------- | ------------ |
| `npm run dev`     | Vite dev server |
| `npm run build`   | Type-check + production build to `dist/` |
| `npm run preview` | Preview the production build |
| `npm run lint`    | Lint with oxlint |
