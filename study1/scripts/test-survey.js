// Survey tests: survey_items.json against the specified definition, per-session ordering (stored,
// reused, groups, fixed attention checks), raw-score storage, validation, the OE1 wording and the
// valid judgement. No LLM calls. Needs the scratch database branch:
//   npm run test:survey -- --host <neon endpoint id of the dev branch>

import { parseArgs } from "node:util";
import { SURVEY, PHASES, orderBlock } from "../lib/survey.js";
import { OE_MIN_CHARS } from "../lib/config.js";
import { rangeOf, anchorsOf } from "../src/survey-shared.js";
import { requireEndpoint } from "./cli.js";
import { createHarness, fill } from "./test-lib.js";

const { values: args } = parseArgs({ options: { host: { type: "string" } } });
requireEndpoint(args.host);
const H = createHarness();
const { sql, check } = H;

const blocks = (phase) => SURVEY[phase] || [];
const block = (phase, id) => blocks(phase).find((b) => b.block === id);
const item = (id) => PHASES.flatMap((p) => blocks(p)).flatMap((b) => b.items).find((i) => i.id === id);
const blockOf = (id) => PHASES.flatMap((p) => blocks(p)).find((b) => b.items.some((i) => i.id === id));
const ids = (phase, id) => block(phase, id).items.map((i) => i.id).join();

try {
  // ---------- the definition ----------
  check("blocks and their order", blocks("pre").map((b) => b.block).join() === "pre_background,pre_ise,pre_smi"
    && blocks("mid").map((b) => b.block).join() === "mid_sa"
    && blocks("post").map((b) => b.block).join() === "post_sa,post_oe1,post_fpq,post_competence,post_likeability,post_sycophancy,post_oe");
  check("items per block (52 in all)", ids("pre", "pre_background") === "D1,D2,D3,E1,E2,AI1,AI2" && ids("pre", "pre_ise") === "ISE1,ISE2,ISE3,ISE4,ISE5"
    && ids("pre", "pre_smi") === "H-Enh,H-Asm,H-Ver,H-Imp,AT1,D-Enh,D-Asm,D-Ver,D-Imp" && ids("mid", "mid_sa") === "SA_pre"
    && ids("post", "post_sa") === "SA_post" && ids("post", "post_oe1") === "OE1"
    && ids("post", "post_fpq") === "US1,US2,US3,AT2,AF2,AF4,AF6,AF1,AF3,AF5" && ids("post", "post_competence") === "C1,C2,C3,C4,C5,C6"
    && ids("post", "post_likeability") === "L1,L2,L3,L4,L5" && ids("post", "post_sycophancy") === "S1,S2,S3,S4" && ids("post", "post_oe") === "OE2,OE3,OE4"
    && PHASES.flatMap((p) => blocks(p)).flatMap((b) => b.items).length === 52);
  const all = PHASES.flatMap((p) => blocks(p)).flatMap((b) => b.items.map((i) => ({ b, i })));
  check("item ids are unique", new Set(all.map((x) => x.i.id)).size === all.length);
  const types = new Set(["likert", "semantic", "single", "multi", "number", "text"]);
  const metaOk = all.every(({ b, i }) => {
    const t = i.type ?? "likert";
    if (!types.has(t) || !(i.scale ?? b.scale)) return false;
    if (t === "likert" || t === "semantic") {
      const r = rangeOf(i, b), a = Object.keys(anchorsOf(i, b)).map(Number);
      if (!r || typeof i.reverse !== "boolean" || a.length < 2 || !a.every((v) => v >= r[0] && v <= r[1])) return false;
      if (!a.includes(r[0]) || !a.includes(r[1])) return false; // both ends are labelled
    }
    return true;
  });
  check("every item has scale, type, range, anchors, reverse (scaled items)", metaOk);
  check("attention checks: AT1 (2) and AT2 (8), fixed, nothing else is a check or fixed",
    all.filter((x) => x.i.check).map((x) => `${x.i.id}=${x.i.check.correct}`).join() === "AT1=2,AT2=8" && all.filter((x) => x.i.fixed).map((x) => x.i.id).join() === "AT1,AT2");
  check("ISE: 1-7, labels at 1 / 4 / 7", JSON.stringify(anchorsOf(item("ISE1"), block("pre", "pre_ise"))) === JSON.stringify({ 1: "전혀 아니다", 4: "어느 정도", 7: "매우 그렇다" })
    && block("pre", "pre_ise").stem === "다음 각 항목을 성공적으로 해낼 수 있다고 얼마나 자신하나요?" && block("pre", "pre_ise").instruction === "자신을 가장 잘 나타내는 응답을 골라 주세요.");
  const smi = block("pre", "pre_smi"), fpq = block("post", "post_fpq");
  check("SMI: 1-7 agree scale, two groups with their stems, AT1 between them",
    smi.range.join() === "1,7" && anchorsOf(smi.items[0], smi)["7"] === "매우 동의함" && smi.groups.map((g) => g.stem).join("|") === "일반적으로, 나는 … 듣는 것을 좋아한다.|일반적으로, 나는 … 알게 되기를 원한다."
    && smi.items.findIndex((i) => i.id === "AT1") === 4 && smi.items.slice(0, 4).every((i) => i.group === "like_to_hear") && smi.items.slice(5).every((i) => i.group === "want_to_discover"));
  check("SMI subscales", smi.items.filter((i) => i.subscale).map((i) => `${i.id}:${i.subscale}`).join() ===
    "H-Enh:enhancement,H-Asm:assessment,H-Ver:verification,H-Imp:improvement,D-Enh:enhancement,D-Asm:assessment,D-Ver:verification,D-Imp:improvement");
  check("SMI items carry **bold** markers (balanced)", item("H-Ver").text.includes("**스스로 생각하는**") && all.every(({ i }) => ((i.text ?? "").match(/\*\*/g) || []).length % 2 === 0));
  check("FPQ: 0-10, usefulness / AT2 / affect with its stem, subscales", fpq.range.join() === "0,10" && anchorsOf(fpq.items[0], fpq)["10"] === "완전히 동의함"
    && fpq.items.findIndex((i) => i.id === "AT2") === 3 && fpq.groups.find((g) => g.id === "affect").stem === "이 피드백을 받고 나니, 나는 …"
    && fpq.items.filter((i) => i.subscale).map((i) => `${i.id}:${i.subscale}`).join() === "US1:usefulness,US2:usefulness,US3:usefulness,AF2:affect_positive,AF4:affect_positive,AF6:affect_positive,AF1:affect_negative,AF3:affect_negative,AF5:affect_negative");
  const comp = block("post", "post_competence"), like = block("post", "post_likeability");
  check("Competence: 7-point differential, reverse on C1 C4 C6 only, pair directions as specified",
    comp.items.filter((i) => i.reverse).map((i) => i.id).join() === "C1,C4,C6" && comp.items.every((i) => i.type === "semantic" && rangeOf(i, comp).join() === "1,7")
    && JSON.stringify(item("C1").anchors) === JSON.stringify({ 1: "똑똑한", 7: "똑똑하지 않은" }) && JSON.stringify(item("C2").anchors) === JSON.stringify({ 1: "훈련되지 않은", 7: "훈련된" })
    && JSON.stringify(item("C4").anchors) === JSON.stringify({ 1: "잘 아는", 7: "잘 모르는" }));
  check("Likeability: 5-point differential, no reverse", like.range.join() === "1,5" && like.items.every((i) => i.type === "semantic" && i.reverse === false)
    && JSON.stringify(item("L2").anchors) === JSON.stringify({ 1: "친해지기 어려운", 5: "친해지기 쉬운" }));
  const syc = block("post", "post_sycophancy");
  check("Perceived sycophancy: 0-10, subscales, no reverse", syc.range.join() === "0,10" && syc.items.map((i) => `${i.id}:${i.subscale}`).join() === "S1:excess_praise,S2:excess_avoidance,S3:sincerity,S4:motive" && syc.items.every((i) => !i.reverse));
  check("self-assessment SA_pre / SA_post: 0-10, labels at 0 and 10",
    anchorsOf(item("SA_pre"), block("mid", "mid_sa"))["0"] === "매우 부족" && anchorsOf(item("SA_post"), block("post", "post_sa"))["10"] === "매우 훌륭"
    && block("post", "post_sa").instruction.startsWith("피드백을 받은 지금, 다시 생각해서 답해 주세요."));
  check("open-ended items are text and required; OE blocks keep their order", ["OE1", "OE2", "OE3", "OE4"].every((id) => item(id).type === "text")
    && block("post", "post_oe").shuffle === false && block("pre", "pre_background").shuffle === false && OE_MIN_CHARS === 5);
  check("D3 other option opens a free-text box; E2 has its note", item("D3").other === "기타(직접 입력)" && item("D3").options.includes("기타(직접 입력)")
    && item("E2").hint.startsWith("실제 채용 과정의 AI 면접"));

  // ---------- ordering ----------
  let fixedOk = true, groupOk = true, plainOk = true;
  const seen = new Set();
  for (let n = 0; n < 400; n++) {
    for (const [b, at] of [[smi, "AT1"], [fpq, "AT2"]]) {
      const o = orderBlock(b);
      if (o[b.items.findIndex((i) => i.id === at)] !== at) fixedOk = false;
      for (const g of b.groups) {
        const members = new Set(b.items.filter((i) => i.group === g.id).map((i) => i.id));
        const pos = b.items.flatMap((i, k) => (i.group === g.id ? [k] : []));
        if (!pos.every((p) => members.has(o[p]))) groupOk = false;
      }
      seen.add(o.join());
    }
    if (orderBlock(block("pre", "pre_background")).join() !== ids("pre", "pre_background") || orderBlock(block("post", "post_oe")).join() !== ids("post", "post_oe")) plainOk = false;
  }
  check("AT1 / AT2 never move; items stay inside their group (400 draws)", fixedOk && groupOk, `${seen.size} distinct orders`);
  check("background and OE2-4 are never shuffled", plainOk);

  // ---------- per session: stored order, validation, raw scores ----------
  const S = await H.started("TS-001");
  const T = S.T;
  const order = (await sql`SELECT survey_order FROM sessions WHERE id = ${S.s.id}`)[0].survey_order;
  const permutation = PHASES.every((p) => blocks(p).every((b) => [...order[p][b.block]].sort().join() === b.items.map((i) => i.id).sort().join()));
  check("every block's order is stored for the session (a permutation of its items)", permutation);
  check("stored order: AT1 / AT2 at their fixed positions, background in config order",
    order.pre.pre_smi[4] === "AT1" && order.post.post_fpq[3] === "AT2" && order.pre.pre_background.join() === ids("pre", "pre_background"));
  check("the same order comes back on reload", JSON.stringify((await T.claim()).survey_order) === JSON.stringify(order));

  const ise = block("pre", "pre_ise");
  check("incomplete block refused", (await T.survey("pre", "pre_ise", { ISE1: 1 })).code === 400);
  check("out-of-range score refused", (await T.survey("pre", "pre_ise", { ...fill(ise), ISE1: 8 })).code === 400);
  check("age must be 10-99", (await T.survey("pre", "pre_background", { ...fill(block("pre", "pre_background")), D2: 9 })).code === 400
    && (await T.survey("pre", "pre_background", { ...fill(block("pre", "pre_background")), D2: 100 })).code === 400);
  const bg = fill(block("pre", "pre_background"), { values: { D3: "기타(직접 입력)" } });
  check("'기타(직접 입력)' needs its free text", (await T.survey("pre", "pre_background", bg)).code === 400);
  check("... and is stored with it", (await T.survey("pre", "pre_background", { ...bg, D3_other: "취업 준비생" })).code === 200
    && (await sql`SELECT value FROM responses WHERE session_id = ${S.s.id} AND item_id = 'D3_other'`)[0]?.value === "취업 준비생");
  check("picking another option clears the free text", (await T.survey("pre", "pre_background", fill(block("pre", "pre_background")))).code === 200
    && (await sql`SELECT count(*)::int AS n FROM responses WHERE session_id = ${S.s.id} AND item_id = 'D3_other'`)[0].n === 0);
  check("open-ended answer needs >= 5 characters (trimmed)", (await T.survey("post", "post_oe", { OE2: "  abcd ", OE3: "충분히 길어요", OE4: "충분히 길어요" })).code === 400
    && (await T.survey("post", "post_oe", { OE2: " abcde ", OE3: "충분히 길어요", OE4: "충분히 길어요" })).code === 200
    && (await sql`SELECT value FROM responses WHERE session_id = ${S.s.id} AND item_id = 'OE2'`)[0].value === "abcde");

  const compFill = fill(comp, { values: { C1: 2, C2: 3, C3: 4, C4: 5, C5: 6, C6: 7 } });
  check("semantic block saved", (await T.survey("post", "post_competence", compFill)).code === 200);
  const comps = await sql`SELECT item_id, value, display_order, scale_id, block_id FROM responses WHERE session_id = ${S.s.id} AND block_id = 'post_competence' ORDER BY item_id`;
  check("scores are stored raw (no reverse coding), with scale, block and display_order",
    comps.map((r) => r.value).join() === "2,3,4,5,6,7" && comps.every((r) => r.scale_id === "Competence" && r.block_id === "post_competence"
      && r.display_order === order.post.post_competence.indexOf(r.item_id) + 1));
  for (const b of blocks("pre")) await T.survey("pre", b.block, fill(b));
  check("saved blocks are reported for resuming (by block id)", JSON.stringify((await T.claim()).surveys.pre.sort()) === JSON.stringify(["pre_background", "pre_ise", "pre_smi"]));
  check("OE1 refused until both self-ratings exist", (await T.survey("post", "post_oe1", { OE1: "이유를 적습니다." })).code === 400);

  // ---------- full runs: OE1 wording and the valid judgement ----------
  async function fullRun(pid, { pre, post, failAT1 = false, failAT2 = false }) {
    const x = await H.started(pid);
    for (const b of blocks("pre")) await x.T.survey("pre", b.block, fill(b, { failChecks: failAT1 && b.block === "pre_smi" }));
    await x.T.survey("mid", "mid_sa", { SA_pre: pre });
    const out = {};
    for (const b of blocks("post")) {
      if (b.block === "post_oe1") out.valuesBefore = (await x.T.claim()).values;
      const r = await x.T.survey("post", b.block, fill(b, { failChecks: failAT2 && b.block === "post_fpq", values: { SA_post: post, OE1: "이유를 적습니다." } }));
      if (r.code !== 200) out.error = `${b.block}: ${r.error}`;
    }
    out.done = await x.T.event("survey_post_submitted");
    [out.row] = await sql`SELECT s.status, s.valid, a.return_reason FROM sessions s JOIN slot_assignments a ON a.session_id = s.id WHERE s.id = ${x.s.id}`;
    [out.oe1] = await sql`SELECT value, shown_text FROM responses WHERE session_id = ${x.s.id} AND item_id = 'OE1'`;
    [out.audit] = await sql`SELECT detail FROM audit_log WHERE session_id = ${x.s.id} AND action = 'completed'`;
    out.id = x.s.id;
    return out;
  }

  const same = await fullRun("TS-002", { pre: 0, post: 0 });
  check("all 10 blocks submitted and the session completes", !same.error && same.done.code === 200 && same.row.status === "completed", same.error);
  check("both self-ratings are offered to the page for the OE1 wording (also 0)", same.valuesBefore.SA_pre === 0 && same.valuesBefore.SA_post === 0);
  check("OE1 wording when the scores are the same (0 and 0), stored with the answer",
    same.oe1.shown_text === "자기평가 문항에서 처음과 피드백을 받은 후 모두 0점을 주셨습니다. 점수가 그대로인 이유는 무엇인가요?" && same.oe1.value === "이유를 적습니다.");
  const [{ n: nResp }] = await sql`SELECT count(*)::int AS n FROM responses WHERE session_id = ${same.id}`;
  check("one response per item (52)", nResp === 52, String(nResp));
  check("AT1 + AT2 correct -> valid, slot kept", same.row.valid === true && same.row.return_reason === null);

  const diff = await fullRun("TS-003", { pre: 4, post: 9, failAT1: true });
  check("OE1 wording when the scores differ (4 and 9)",
    diff.oe1.shown_text === "자기평가 문항에서 처음에는 4점, 피드백을 받은 후에는 9점을 주셨습니다. 점수가 달라진 이유는 무엇인가요?");
  check("AT1 wrong -> valid=false (AT1), slot returned", diff.row.valid === false && diff.audit.detail.failed.join() === "AT1" && diff.row.return_reason === "invalid");
  const at2 = await fullRun("TS-004", { pre: 5, post: 5, failAT2: true });
  check("AT2 wrong -> valid=false (AT2)", at2.row.valid === false && at2.audit.detail.failed.join() === "AT2");
  const both = await fullRun("TS-005", { pre: 3, post: 6, failAT1: true, failAT2: true });
  check("AT1 and AT2 wrong -> valid=false (both)", both.row.valid === false && both.audit.detail.failed.join() === "AT1,AT2");
} finally {
  await H.cleanup();
}
H.finish();
