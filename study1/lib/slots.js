// Seeded slot sequence: blocks of the 6 stance x modality cells, each block an independent permutation.
// Deterministic given the seed, so the sequence can be regenerated and checked from slot_meta.

import crypto from "crypto";
import { CONDITIONS } from "../src/questions.js";
import { MODALITIES } from "./config.js";

export const CELLS = CONDITIONS.flatMap((stance) => MODALITIES.map((modality) => ({ stance, modality })));
export const ALGORITHM =
  "fisher-yates v1: j = uniform(0..i) from HMAC-SHA256(key=seed bytes, msg=`b{block}:i{i}:c{ctr}`), first 4 bytes BE, rejection sampling";

// Uniform integer in [0, n) — rejection sampling avoids modulo bias.
function uniform(seed, label, n) {
  const limit = Math.floor(2 ** 32 / n) * n;
  for (let ctr = 0; ; ctr++) {
    const x = crypto.createHmac("sha256", Buffer.from(seed, "hex")).update(`${label}:c${ctr}`).digest().readUInt32BE(0);
    if (x < limit) return x % n;
  }
}

// -> [{ seq, block, stance, modality }], seq 1..blocks*CELLS.length
export function generateSlots(seed, blocks) {
  if (!/^[0-9a-f]{32,}$/i.test(seed)) throw new Error("seed must be hex, at least 16 bytes");
  const out = [];
  for (let b = 1; b <= blocks; b++) {
    const a = [...CELLS];
    for (let i = a.length - 1; i > 0; i--) {
      const j = uniform(seed, `b${b}:i${i}`, i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    a.forEach((cell, k) => out.push({ seq: (b - 1) * a.length + k + 1, block: b, ...cell }));
  }
  return out;
}
