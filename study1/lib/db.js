// Neon Postgres over HTTP. DATABASE_URL is injected by the Vercel Neon integration
// (locally: `vercel env pull .env.local`).

import { neon } from "@neondatabase/serverless";

let client = null;

export function db() {
  if (!client) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
    client = neon(process.env.DATABASE_URL);
  }
  return client;
}

export const isUniqueViolation = (e) => e?.code === "23505";
