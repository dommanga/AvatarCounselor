import os, glob, json, hashlib, datetime, itertools
from openai import OpenAI

MODEL        = "gpt-4o"
STAGE1_TEMP  = 0.0
STAGE2_TEMPS = [0.3]     # v2 sweep
CONDITIONS   = ["reversing", "minimizing", "direct"]
ELEMENTS     = ["situation", "task_and_action", "result"]
LABELS = {0: "absent", 1: "vague", 2: "specific"}

INPUT_WHITELIST = ["sitweak_yujin", "sitweak_jiwon", "actweak_taehyun", "actweak_minseo", "tie_SA_jiwon"]   # 12개 다 하려면 [] 로

FACTORS = ["transcript", "rating", "quote"]
CONFIGS = [{"transcript": True, "rating": True, "quote": False}]

client = OpenAI()

def call(prompt, temp):
    r = client.chat.completions.create(
        model=MODEL, temperature=temp,
        messages=[{"role": "user", "content": prompt}])
    return r.choices[0].message.content.strip()

def load(p):
    with open(p, encoding="utf-8") as f:
        return f.read()

def parse_stage1(raw):
    s = raw[raw.index("{"): raw.rindex("}") + 1]
    d = json.loads(s)
    out = {}
    for e in ELEMENTS:
        v = d.get(e) or d.get(e.upper()) or {}
        out[e] = {"rating": v.get("rating", 0), "quote": v.get("quote", "")}
    return out

def select_weak(scores, seed):
    lo = min(scores[e]["rating"] for e in ELEMENTS)
    tied = sorted(e for e in ELEMENTS if scores[e]["rating"] == lo)
    if len(tied) == 1:
        return tied[0]
    h = int(hashlib.sha256(seed.encode("utf-8")).hexdigest(), 16)
    return tied[h % len(tied)]

def build_context(question, transcript, target, scores, cfg):
    lines = [f"Question: {question}"]
    if cfg["rating"]:
        lines.append("Assessment of the candidate's answer (0=absent, 1=vague, 2=specific):")
        for e in ELEMENTS:
            r = scores[e]["rating"]
            lines.append(f"- {e.upper()}: {r} ({LABELS[r]})")
    lines.append(f"Target element to address: {target.upper()}")
    if cfg["quote"] and scores[target]["quote"].strip():
        lines.append(f'What the candidate said about the target (verbatim): "{scores[target]["quote"]}"')
    if cfg["transcript"]:
        lines.append(f'Full answer transcript: "{transcript}"')
    return "\n".join(lines)

def cfg_label(cfg):
    return "".join(("T" if cfg["transcript"] else "t",
                    "R" if cfg["rating"] else "r",
                    "Q" if cfg["quote"] else "q"))

stage1_tmpl  = load("prompts/stage1.md")
stage2_tmpls = {c: load(f"prompts/stage2_{c}.md") for c in CONDITIONS}

stamp  = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
out    = f"outputs/v2_{stamp}.md"
report = [f"# Stage2 v2 — contrastive example x temp sweep  ({stamp})",
          f"model={MODEL}  stage1_temp={STAGE1_TEMP}  stage2_temps={STAGE2_TEMPS}",
          f"config fixed = TRq (transcript on, full rating on, quote off)"]

for inp in sorted(glob.glob("inputs/*.md")):
    name = os.path.splitext(os.path.basename(inp))[0]
    if INPUT_WHITELIST and name not in INPUT_WHITELIST:
        continue
    head, _, body = load(inp).partition("\n")
    question, transcript = head.removeprefix("Q:").strip(), body.strip()

    s1_raw = call(stage1_tmpl.replace("<<QUESTION>>", question)
                             .replace("<<TRANSCRIPT>>", transcript), STAGE1_TEMP)
    scores = parse_stage1(s1_raw)
    weak   = select_weak(scores, transcript)

    report += [f"\n\n## {name}",
               "scores: " + ", ".join(f"{e}={scores[e]['rating']}" for e in ELEMENTS)
               + f"  →  **weak = {weak.upper()}**"]

    ctx = build_context(question, transcript, weak, scores, CONFIGS[0])
    for temp in STAGE2_TEMPS:
        report.append(f"\n### temp {temp}")
        for c in CONDITIONS:
            s2 = call(stage2_tmpls[c].replace("<<CONTEXT>>", ctx), temp)
            report.append(f"- **{c}**: {s2}")
        with open(out, "w", encoding="utf-8") as f:
            f.write("\n".join(report))

print(f"done -> {out}")