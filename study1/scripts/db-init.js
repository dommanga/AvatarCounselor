// Applies lib/schema.sql. Safe to re-run (all statements are idempotent).
//   npm run db:init        (reads DATABASE_URL from .env / .env.local)

import fs from "fs";
import { db } from "../lib/db.js";

const sql = db();
const ddl = fs.readFileSync(new URL("../lib/schema.sql", import.meta.url), "utf8");
// strip comments first: they contain ';' and would otherwise break the naive split
const statements = ddl.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);
for (const stmt of statements) await sql.query(stmt);
console.log(`schema: ${statements.length} statements applied`);
