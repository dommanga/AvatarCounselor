// Two kinds of caller:
//  - researcher: password (RESEARCHER_PASSWORD env) -> HMAC-signed HttpOnly cookie, scoped to /api.
//  - participant device: random bearer token issued at session creation; only its sha256 is stored.

import crypto from "crypto";
import { db } from "./db.js";

const COOKIE = "rauth";
const TTL_S = 12 * 60 * 60;

function secret() {
  const p = process.env.RESEARCHER_PASSWORD;
  if (!p) throw new Error("RESEARCHER_PASSWORD is not set");
  return p;
}

const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const sign = (payload) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

function safeEqual(a, b) {
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

const cookie = (value, maxAge) =>
  `${COOKIE}=${value}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

export function checkPassword(pw) {
  return typeof pw === "string" && safeEqual(sha256(pw), sha256(secret()));
}

export function setResearcherCookie(res) {
  const exp = Math.floor(Date.now() / 1000) + TTL_S;
  res.setHeader("Set-Cookie", cookie(`${exp}.${sign("researcher:" + exp)}`, TTL_S));
}

export function clearResearcherCookie(res) {
  res.setHeader("Set-Cookie", cookie("", 0));
}

export function isResearcher(req) {
  const v = req.cookies?.[COOKIE];
  if (!v) return false;
  const [exp, sig] = v.split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, sign("researcher:" + exp));
}

// Sends the 401 itself; callers just `if (!requireResearcher(req, res)) return;`
export function requireResearcher(req, res) {
  if (isResearcher(req)) return true;
  res.status(401).json({ error: "연구자 로그인이 필요합니다." });
  return false;
}

export function newParticipantToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: sha256(token) };
}

// Resolves the bearer token to its session row, or sends 401 and returns null.
export async function requireParticipant(req, res) {
  const m = /^Bearer (\S+)$/.exec(req.headers.authorization || "");
  if (m) {
    const [s] = await db()`SELECT * FROM sessions WHERE token_hash = ${sha256(m[1])}`;
    if (s) return s;
  }
  res.status(401).json({ error: "no active session" });
  return null;
}
