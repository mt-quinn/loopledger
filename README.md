# WhichStitch

WhichStitch is a mobile-first knit counter web app built with Next.js and prepared for Vercel hosting.

## Stack

- Next.js (App Router)
- TypeScript
- Plain CSS (mobile-first, iPad-responsive)

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Deploy to Vercel

1. Push this repo to GitHub/GitLab/Bitbucket.
2. In Vercel, create a new project and import the repo.
3. Keep defaults:
   - Framework preset: `Next.js`
   - Build command: `next build`
   - Output: `.next`
4. Deploy.

## Initial structure

- `app/layout.tsx`: page metadata and viewport setup
- `app/page.tsx`: starter WhichStitch dashboard shell
- `app/globals.css`: visual system and responsive layout
