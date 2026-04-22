# SEO Playground — Self-hosted SEO Dashboard

> **Work in progress** — new DataForSEO endpoints are being added progressively.

SEO Playground is a self-hosted Next.js 15 dashboard that runs SEO and local-SEO queries against the [DataForSEO API](https://dataforseo.com/). Every search is cached to a PostgreSQL database, so you can browse your history and revisit results without spending extra API credits. The app supports multiple users via email/password auth (each user sees only their own history and DataForSEO credentials).

Designed to deploy in a single click on [Coolify](https://coolify.io/) — but it runs just as well under any Docker + Postgres setup.

If you find this useful, consider supporting the project:

[![Buy Me A Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/paulmassendari)
[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/paulmassendari)

## Screenshots

![Local Finder — Grid Search](public/screenshot-local-finder.png)
*Local Finder: grid search showing local rankings across a geographic area*

![Rank Tracker](public/screenshot-rank-tracker.png)
*Rank Tracker: monitor keyword positions over time for any domain*

![Google Reviews Analysis](public/review-analysis-screenshot.png)
*Google Reviews: rating distribution, monthly review chart, and rating goal calculator*

## Features

- **Rank Tracker** — Track keyword positions over time for any domain
- **SERP Checker** — Analyze Google organic results with target domain highlighting
- **Ranked Keywords** — Discover what keywords a domain ranks for
- **Keyword Overview** — Metrics (volume, CPC, competition) for a list of keywords
- **Keyword Data** — Google Ads & Bing keyword research
- **Keyword Difficulty** — Bulk difficulty scores via DataForSEO Labs
- **Related Keywords** — Keyword ideas from a seed keyword
- **Competitors** — Find competing domains in the SERPs
- **Domain Intersection** — Common keywords between two domains
- **Historical Rank** — Ranking history overview for a domain
- **Backlinks** — Full backlink profile (summary, list, referring domains, anchors)
- **Local Finder** — Local business listings with grid search for geographic visibility analysis
- **On-Page** — On-page SEO audit with microdata analysis
- **Google Reviews** — Fetch and analyze Google Business reviews: rating distribution, monthly chart, and rating goal calculator
- **AI Optimization** — AI-powered content optimization suggestions
- **Reddit Mentions** — Discover Reddit threads linking to or discussing your URLs
- **Settings** — Store your DataForSEO credentials (encrypted at rest)

## Requirements

- Node.js 22+ (runtime matches the Docker image)
- PostgreSQL 15+ (Coolify provides this for you; locally, run your own via Docker or a native install)
- A [DataForSEO](https://dataforseo.com/) account (API login + password)

## Deploy on Coolify (recommended)

1. Push the repo to GitHub.
2. In Coolify: create a **PostgreSQL** resource — copy the connection string it generates.
3. Create a new **Application** from your GitHub repo; Coolify auto-detects the `Dockerfile`.
4. In the Application's Environment panel, set:
   - `DATABASE_URL` — paste from the Postgres resource
   - `BETTER_AUTH_SECRET` — `openssl rand -base64 32`
   - `ENCRYPTION_KEY` — `openssl rand -hex 32` (64 hex characters)
   - `BETTER_AUTH_URL` and `NEXT_PUBLIC_BETTER_AUTH_URL` — both set to your public URL (e.g. `https://seo.example.com`)
   - `ADMIN_EMAIL` — optional; the first signup with this email is promoted to `role=admin`
5. Deploy. On first boot, `prisma db push` creates every table automatically.
6. Visit `https://<your-domain>/auth/signup`, register, then go to **Settings** and paste your DataForSEO login and password. The password is encrypted at rest with AES-256-GCM.

## Run locally

```bash
# 1. Clone and install
git clone <your-fork>
cd seo-playground
npm install

# 2. Start a local Postgres (example with Docker)
docker run --name seo-pg -e POSTGRES_PASSWORD=devpass -p 5432:5432 -d postgres:16

# 3. Configure env
cp .env.example .env.local
# edit .env.local — set DATABASE_URL, BETTER_AUTH_SECRET, ENCRYPTION_KEY, etc.

# 4. Push the schema
npx prisma db push

# 5. Run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign up, and paste your DataForSEO credentials on the Settings page.

## Data Storage

- **Postgres** holds everything: user accounts, sessions, DataForSEO credentials (encrypted), and cached search history.
- The schema lives in [`prisma/schema.prisma`](prisma/schema.prisma). Changes are synced via `npm run db:push`; for production you should graduate to `prisma migrate deploy` with committed migration files.
- The legacy `seo-playground.db` SQLite file is no longer used (safe to delete after the cutover).

## Tech Stack

- [Next.js 15](https://nextjs.org/) — App Router, Server Actions
- [React 19](https://react.dev/)
- [Tailwind CSS v4](https://tailwindcss.com/)
- [Prisma 7](https://www.prisma.io/) + [`@prisma/adapter-pg`](https://www.npmjs.com/package/@prisma/adapter-pg)
- [better-auth](https://www.better-auth.com/) — email/password auth, session cookies
- [Leaflet](https://leafletjs.com/) — maps
- [Lucide React](https://lucide.dev/) — icons

## License

MIT
