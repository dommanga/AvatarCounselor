import os, glob, json, datetime, collections
from openai import OpenAI

MODEL        = "gpt-4o"
STAGE1_TEMP  = 0.0     # 안정성 보려면 0 부터. 나중에 이 값을 확정해서 run.py 에 씀
N_REPEATS    = 10      # 입력당 Stage 1 반복 횟수

client = OpenAI()

def call(prompt, temp):
    r = client.chat.completions.create(
        model=MODEL, temperature=temp,
        messages=[{"role": "user", "content": prompt}],
    )
    return r.choices[0].message.content.strip()

def load(p):
    with open(p, encoding="utf-8") as f:
        return f.read()

def parse_scores(raw):
    """Stage1 JSON 에서 세 element 점수만 뽑아 비교용 키로. 실패하면 raw 전체."""
    try:
        s = raw[raw.index("{"): raw.rindex("}") + 1]
        d = json.loads(s)
        def g(k):
            v = d.get(k, d.get(k.upper(), {}))
            return v.get("rating", v) if isinstance(v, dict) else v
        return json.dumps({k: g(k) for k in
                           ["situation", "task_and_action", "result"]},
                          sort_keys=True)
    except Exception:
        return "UNPARSEABLE::" + " ".join(raw.split())

stage1_tmpl = load("prompts/stage1.md")
stamp  = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
out    = f"outputs/stage1_check_{stamp}.md"
report = [f"# Stage 1 stability  (model={MODEL}, temp={STAGE1_TEMP}, N={N_REPEATS})"]

for inp in sorted(glob.glob("inputs/*.md")):
    name = os.path.splitext(os.path.basename(inp))[0]
    head, _, body = load(inp).partition("\n")
    prompt = (stage1_tmpl
              .replace("<<QUESTION>>", head.removeprefix("Q:").strip())
              .replace("<<TRANSCRIPT>>", body.strip()))

    keys, raws = [], []
    for _ in range(N_REPEATS):
        raw = call(prompt, STAGE1_TEMP)
        raws.append(raw)
        keys.append(parse_scores(raw))

    counts = collections.Counter(keys)
    top_key, top_n = counts.most_common(1)[0]
    report += [f"\n## {name}",
               f"- distinct score-patterns: **{len(counts)}**",
               f"- modal agreement: **{top_n}/{N_REPEATS}**",
               f"- modal scores: `{top_key}`"]
    for k, n in counts.most_common():
        report.append(f"    - {n}x  `{k}`")
    # 첫 출력 원문(포맷 눈으로 확인용)
    report.append(f"\n<details><summary>sample raw</summary>\n\n```json\n{raws[0]}\n```\n</details>")

    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(report))

print(f"done -> {out}")