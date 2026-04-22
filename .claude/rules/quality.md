# Code Quality Rules

- Write clean, readable code with meaningful variable and function names
- Add brief comments only for non-obvious logic (the WHY, not the WHAT)
- Always explain what you're about to change before making edits
- Ask before deleting any file or directory
- Test changes by running the dev server or relevant npm scripts before committing
- Handle errors gracefully with clear error messages
- Keep functions small and focused on one task
- Use consistent formatting (Prettier / ESLint defaults) throughout the project
- Before writing Next.js code, consult `node_modules/next/dist/docs/` — this repo uses Next.js 15 App Router with Server Actions, which differs from older patterns
- Prisma schema is the source of truth for the data layer. Edit `prisma/schema.prisma`, then run `npx prisma generate`. NEVER hand-edit `src/generated/prisma/` — it is regenerated on every install.
- Every db helper in `src/lib/db.ts` takes `userId` as its first argument. Server actions and RSC pages MUST call `requireUserId()` from `@/lib/session` and pass it through.
- DataForSEO credentials are encrypted at rest via `src/lib/crypto.ts`. Never log decrypted passwords, never write them to files, and never bypass the `UserCredential` table.
