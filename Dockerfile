FROM node:22-alpine

# libc6-compat: prisma/pg on alpine. openssl: prisma/better-auth runtime.
RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

# Install deps first for layer caching. `postinstall` runs `prisma generate`,
# which needs prisma/schema.prisma — copy it alongside package*.json.
COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

EXPOSE 3000

# Coolify polls this to decide when the container is live. `/auth/signin` is
# public (no session needed) so it's the safest unauthenticated target.
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 \
  CMD wget --spider -q http://localhost:3000/auth/signin || exit 1

# `prisma db push --accept-data-loss` syncs the schema on every boot. Safe on
# a greenfield Postgres — DANGEROUS if you later mutate the schema with live
# data. Follow-up: switch to `prisma migrate deploy` + committed migrations.
CMD ["sh", "-c", "echo '===== SYNCING DATABASE SCHEMA =====' && npx prisma db push --accept-data-loss && echo '===== STARTING SERVER =====' && npm start"]
