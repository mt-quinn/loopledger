# WhichStitch

WhichStitch is a mobile-first workspace for knitting from PDF patterns. Import a
pattern and mark it up, drop row/stitch counters directly onto the pages, chain
counters so one increments another, capture a zoomable reference crop (like a
chart), convert counts between the pattern's gauge and your own, and save named
scroll anchors to jump around long patterns. Projects sync to your account and
are cached on-device so recently opened patterns keep working offline.

## Stack

- Next.js (App Router) + React + TypeScript, plain CSS (`app/globals.css`)
- [Convex](https://convex.dev) for auth (email/password), database, and PDF
  file storage — there is no other backend
- `pdfjs-dist` for client-side PDF rendering (worker bundled with the app)
- IndexedDB as an offline cache of PDFs and workspaces

## Layout

- `app/page.tsx` → `components/ProjectHub.tsx`: sign-in and the project library
- `app/projects/[projectId]/page.tsx`: the pattern editor (annotations,
  counters, calculator, reference viewer, anchors)
- `convex/`: schema, auth config, and all queries/mutations (`projects.ts`)
- `lib/local-db.ts`: IndexedDB offline cache + legacy local-project migration
- `lib/project-types.ts`: shared workspace types and constants (kept in sync
  with the Convex validators in `convex/workspace.ts`)

## Local development

```bash
npm install
npx convex dev   # provisions/links a Convex dev deployment, writes .env.local
npm run dev      # in a second terminal
```

Open `http://localhost:3000`. `.env.local` needs `CONVEX_DEPLOYMENT` and
`NEXT_PUBLIC_CONVEX_URL`, both written by `npx convex dev`.

To seed a test account with a sample project:

```bash
CONVEX_URL=<your NEXT_PUBLIC_CONVEX_URL> node scripts/seed.mjs
```

(The account `tester@loopledger.test` must already exist — create it through
the sign-up form first, or set `SEED_EMAIL`/`SEED_PASSWORD`.)

## Deploy

1. Deploy Convex: `npx convex deploy` (creates/updates the production
   deployment).
2. Host the Next.js app (e.g. Vercel) with `NEXT_PUBLIC_CONVEX_URL` set to the
   production Convex URL.
