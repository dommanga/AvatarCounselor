# Study 1 — AI interview coach (main experiment)

Static frontend + Vercel serverless functions + Neon Postgres. See `SPEC.md` for the study flow.

## Pages
- `/` — participant flow: pre-survey → scenario → practice → Q1–Q3 → post-survey → done.
  Shows "waiting" until a session is handed over from `/researcher` on the same tab.
- `/researcher` — password-protected. Create a session (participant ID + condition; the next slot of
  the pre-generated block sequence is suggested), then the device switches to `/`. Creating a session
  logs the researcher out on that device, so the participant can't get back in.

## Endpoints
- `POST /api/researcher/{login,logout,create,resume}`, `GET /api/researcher/overview` — researcher cookie
- `GET /api/session/state`, `POST /api/session/{event,answer}` — participant bearer token
- `POST /api/assess`, `POST /api/feedback` — dev "API 테스트" view only; researcher login required

`prompts.js` is auto-generated from `experiment/prompts/*.md`. Regenerate if prompts change.

## Setup
1. Vercel project → Storage → add **Neon Postgres** (sets `DATABASE_URL`).
2. Set `OPENAI_API_KEY` and `RESEARCHER_PASSWORD` in project env vars.
3. Put `DATABASE_URL`, `OPENAI_API_KEY`, `RESEARCHER_PASSWORD` in a local **`.env`** — `vercel dev`
   (CLI 60) reads `.env`, not `.env.local`. Then `npm i` and `npm run db:init` (reads either file)
   — creates tables and generates the 10×3 block sequence once (re-running never regenerates it).

## Local dev
    npx vercel dev        # serves static + /api on http://localhost:3000
