# Study 1 — AI interview coach (online experiment)

Static frontend + Vercel serverless functions + Neon Postgres.

## Pages
- `/` — participant flow: pre-survey → scenario → practice → Q2 → post-survey → done.
  Shows "waiting" until this tab holds a session token. (Online session creation: Phase 2.)

## Endpoints
- `POST /api/researcher/{login,logout}` — researcher cookie
- `GET /api/session/state`, `POST /api/session/{event,answer,survey}` — participant bearer token
- `POST /api/assess`, `POST /api/feedback` — dev "API 테스트" view only; researcher login required

`prompts.js` is auto-generated from `experiment/prompts/*.md`. Regenerate if prompts change.

## Setup
1. Vercel project → Storage → add **Neon Postgres** (sets `DATABASE_URL`).
2. Set `OPENAI_API_KEY` and `RESEARCHER_PASSWORD` in project env vars.
3. Put `DATABASE_URL`, `OPENAI_API_KEY`, `RESEARCHER_PASSWORD` in a local **`.env`** — `vercel dev`
   (CLI 60) reads `.env`, not `.env.local`. Locally, `DATABASE_URL` points at the Neon `dev` branch;
   all development and rehearsals run there. Then `npm i` and `npm run db:init` (reads either file).

## Local dev
    npx vercel dev        # serves static + /api on http://localhost:3000
