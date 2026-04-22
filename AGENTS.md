<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# SEO Playground

> Self-hosted Next.js 15 dashboard for running SEO / local-SEO queries against the DataForSEO API. Deployed via Docker on Coolify, backed by PostgreSQL, with email/password auth (better-auth) and per-user DataForSEO credentials encrypted at rest (AES-256-GCM).

## Tech Stack

- Language: TypeScript 5
- Framework: Next.js 15 (App Router, Server Actions) + React 19
- Styling: Tailwind CSS v4
- Database: PostgreSQL 16 via Prisma 7 + `@prisma/adapter-pg`
- Auth: better-auth (email + password, session cookies)
- Maps / icons: Leaflet, Lucide React
- Lint: ESLint 9 + `eslint-config-next` 16
- Deployment: Dockerfile → Coolify (auto-detected)

## Commands

```bash
npm run dev         # Start dev server on http://localhost:3000
npm run build       # prisma generate + next build
npm start           # Run the production build
npm run lint        # ESLint
npm run db:push     # Sync prisma/schema.prisma → Postgres (no migrations)
npm run db:studio   # Open Prisma Studio against DATABASE_URL
```

## Project Structure

```
prisma/
  schema.prisma       # Source of truth for the data model
src/
  app/                # App Router routes + Server Actions
    auth/             # /auth/signin, /auth/signup pages
    api/auth/[...all] # better-auth HTTP surface
    dashboard/        # Tool pages — every RSC calls requireUserId()
  components/         # Shared React components
  generated/prisma/   # Prisma client output (gitignored)
  lib/
    db.ts             # Per-user data access helpers (userId = first arg)
    prisma.ts         # PrismaClient singleton with PrismaPg adapter
    auth.ts           # better-auth config
    auth-client.ts    # createAuthClient for client components
    session.ts        # requireUserId() / getOptionalUserId()
    crypto.ts         # AES-256-GCM encrypt/decrypt for dfs-pass
  middleware.ts       # Gates /dashboard, /auth, /api
Dockerfile
.env.example
```

## Required env vars

```
DATABASE_URL                   # Postgres connection string
BETTER_AUTH_SECRET             # openssl rand -base64 32
BETTER_AUTH_URL                # public base URL, no trailing slash
NEXT_PUBLIC_BETTER_AUTH_URL    # same value, exposed to client bundle
ENCRYPTION_KEY                 # openssl rand -hex 32   (64 hex chars)
ADMIN_EMAIL                    # optional: first signup becomes admin
```

## Decision Flow

1. Existing code does what's needed? → Use it, don't rewrite.
2. Need new code? → Write the minimal change that solves the problem.
3. Error? → Read the error, fix the root cause, test again — do not mask with try/catch.
4. Unsure about scope? → Ask before proceeding.

## Key Principles

- Simple beats clever. A good if/else beats a bad abstraction.
- Don't add features beyond what was asked.
- Don't add comments or docstrings to code you didn't change.
- Validate at system boundaries only (user input, external DataForSEO responses).
- No backwards-compatibility shims for code you're certain is unused.
- Read `node_modules/next/dist/docs/` before using Next.js APIs — training data may be wrong for v15.

## Human-in-the-Loop

Always ask before: deleting files, pushing to git, installing/removing packages, modifying `next.config.ts` / `tsconfig.json` / `eslint.config.mjs` / `Dockerfile` / `prisma/schema.prisma`, running destructive Prisma commands (`migrate reset`, `db push --force-reset`).
Auto-approve: reading files, running `npm run dev`, `npm run lint`, `prisma generate`, formatting code.

Credentials: DataForSEO creds live in `UserCredential.dfsPassword` as AES-256-GCM ciphertext keyed by `ENCRYPTION_KEY`. **Never** log them, commit them, copy them into `.env*`, or bypass the encryption. The project's `.claude/settings.json` denies writes to `.env*`, `*.secret`, `*.pem`, and the generated Prisma client, and asks before `git push`, `git commit`, `npm install`/`uninstall`, and `prisma migrate reset`.

## Compact Instructions

When compacting, always preserve:
- Current task objective and acceptance criteria
- File paths modified this session
- Last dev-server / lint / `prisma generate` output
- Any DataForSEO endpoint being integrated and its response shape
- Schema state: whether `prisma/schema.prisma` was edited this session

Use `/compact focus on [topic]` — never bare `/compact`.

## Memory System

Claude has 3 memory layers:

1. **CLAUDE.md → AGENTS.md** (this file) — never compacted, always loaded. Permanent rules go here.
2. **Auto memory** (`~/.claude/projects/.../MEMORY.md`) — Claude writes patterns and lessons. Check with `/memory`.
3. **Session context** — conversation history. Lost on `/clear` or new session.

Rule: if a rule matters, put it in AGENTS.md — not in chat.

## Gotchas

- **Prisma schema is the source of truth.** Edit `prisma/schema.prisma`, then `npx prisma generate`. Never hand-edit `src/generated/prisma/`.
- **Every db helper takes `userId` as first argument.** RSC pages and server actions MUST call `requireUserId()` from `@/lib/session` before any db call. Forgetting this leaks data across users or throws at runtime.
- **Nullable Json fields need `Prisma.DbNull`, not JS `null`.** `src/lib/db.ts` exports `toNullableJson()` — use it.
- **`ts` columns are `BigInt` in Prisma.** Convert at the boundary with `toBigInt(Date.now())` for writes and `fromBigInt(row.ts)` for reads — helpers at the top of `src/lib/db.ts`.
- Leaflet requires `window`; wrap map components in dynamic imports with `ssr: false`.
- Server Actions in Next.js 15 — do not import client-only code into `"use server"` files.
- DataForSEO endpoints return data under varying shapes (sometimes `tasks[0].result`, sometimes a flat object). Always inspect the actual response shape before assuming a wrapper key.
- On first boot the Dockerfile runs `prisma db push --accept-data-loss`. Safe on greenfield Postgres, DANGEROUS after schema changes with real data — switch to `prisma migrate deploy` + committed migrations when the prod DB has something to lose.

## Reference Docs

- [DataForSEO API docs](https://docs.dataforseo.com/v3/)
- Next.js 15 local docs: `node_modules/next/dist/docs/`
- [Prisma docs](https://www.prisma.io/docs)
- [better-auth docs](https://www.better-auth.com/docs)
- [Leaflet](https://leafletjs.com/)
