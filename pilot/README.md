# Sycophancy pilot — v1

Minimal stimulus/inspection tool for pre-pilot. v0 = question -> answer -> PHASE 1 scores + all 3 condition feedbacks. No logging / rotation / eval panel / comparison tail (those are v1).

## Endpoints
- `POST /api/assess`   { question, transcript } -> { scores, strong, weak, context }   (PHASE 1, temp 0)
- `POST /api/feedback` { context, condition }   -> { condition, feedback, raw }         (PHASE 2, temp 0.3)

`prompts.js` is auto-generated from `experiment/prompts/*.md`. Regenerate if prompts change.

## Local dev
    npm i
    npx vercel dev        # serves static + /api on http://localhost:3000
Needs OPENAI_API_KEY in a local `.env` (or `vercel env pull`).

## Deploy
Push to a repo, import in Vercel, set OPENAI_API_KEY env var. Static frontend + /api serverless functions deploy together. Hobby (free) tier is fine for a research pilot.
