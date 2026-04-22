// Ambient typings for process.env — keeps autocomplete honest without
// asserting `!` at every call site.

declare namespace NodeJS {
  interface ProcessEnv {
    // Postgres connection string, injected by Coolify in prod.
    DATABASE_URL: string;

    // better-auth: session signing + the base URL better-auth trusts for callbacks.
    BETTER_AUTH_SECRET: string;
    BETTER_AUTH_URL: string;
    // Same value as BETTER_AUTH_URL, but exposed to the client bundle.
    NEXT_PUBLIC_BETTER_AUTH_URL: string;

    // AES-256-GCM key for encrypting DataForSEO passwords at rest.
    // 32 bytes as 64-char hex (or base64). Generate: `openssl rand -hex 32`.
    ENCRYPTION_KEY: string;

    // First signup matching this email is promoted to role="admin".
    ADMIN_EMAIL?: string;

    // Set by the container runtime — used by middleware's internal loopback.
    PORT?: string;
  }
}
