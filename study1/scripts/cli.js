// Shared helpers for the scripts/ CLIs.

// Neon endpoint id of DATABASE_URL (e.g. ep-frosty-hall-b70i06ci), which tells the branches apart.
export function dbEndpoint() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  return new URL(process.env.DATABASE_URL).hostname.split(".")[0].replace(/-pooler$/, "");
}

// Destructive scripts run only when the caller names the endpoint they expect to hit.
export function requireEndpoint(expected) {
  const actual = dbEndpoint();
  if (expected !== actual) {
    console.error(`refusing: DATABASE_URL points at ${actual}. Re-run with --host ${actual} if that is the intended branch.`);
    process.exit(1);
  }
}

export function fail(msg) {
  console.error(msg);
  process.exit(1);
}
