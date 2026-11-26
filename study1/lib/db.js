// Neon Postgres. DATABASE_URL is injected by the Vercel Neon integration
// (locally: `.env`, pointing at the Neon `dev` branch).

import { neon, Pool } from "@neondatabase/serverless";

let client = null;

function url() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  return process.env.DATABASE_URL;
}

// HTTP driver: single statements and fixed statement batches (sql.transaction([...])).
export function db() {
  return (client ??= neon(url()));
}

// Interactive transaction over a WebSocket connection, for logic that has to read, lock and branch
// inside one transaction (condition assignment, tab claims). A fresh Pool per call: serverless
// functions shouldn't keep sockets open between invocations.
export async function withTransaction(fn) {
  const pool = new Pool({ connectionString: url() });
  // A WebSocket connection can fail transiently; nothing has run yet at this point, so retrying is safe.
  let c;
  for (let attempt = 1; ; attempt++) {
    try {
      c = await pool.connect();
      await c.query("BEGIN");
      break;
    } catch (e) {
      c?.release(true);
      c = undefined;
      if (attempt >= 3) { await pool.end().catch(() => {}); throw e instanceof Error ? e : new Error(e?.message || "database connection failed"); }
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
  try {
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}

export const isUniqueViolation = (e) => e?.code === "23505";
