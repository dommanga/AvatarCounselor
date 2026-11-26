# Study 1 — AI interview coach (online experiment)

Static frontend + Vercel serverless functions + Neon Postgres. No personal data in the database:
participants are a participant_id (`S1-001`) and a link token; the mapping to people lives only in the
researcher's spreadsheet.

## Pages
- `/s/{token}` — participant flow: consent → pre-survey → scenario → practice → Q2 → post-survey → done.
  Expired / completed / locked links and a second window get their own notice screens.
- `/` without a token asks for the participant link.

## Endpoints
- `GET /api/session/state`, `POST /api/session/{claim,heartbeat,release,consent,event,survey,answer,segment,audio}`
  — link token as bearer + `X-Client-Key` (one active tab per session); see the header of `api/session/[action].js`
- `POST /api/researcher/{login,logout}` — researcher cookie
- `POST /api/assess`, `POST /api/feedback` — dev "API 테스트" view only; researcher login required

`prompts.js` is auto-generated from `experiment/prompts/*.md`. Regenerate if prompts change.

## Session lifecycle
`issued → opened → consented → in_progress → completed | expired | abandoned | locked`
- Condition (stance × modality) is assigned at consent from a seeded 6-cell block sequence (`slots`);
  slots of abandoned / locked / invalid (failed attention check) sessions are returned and refilled first.
- One resume after consent; the second locks the session. One re-answer chance per session.
- Every issue / assignment / return / lock is in `audit_log`. Settings live in `lib/config.js`.

## Scripts (read `DATABASE_URL` from `.env`)
    npm run db:init                                   # apply lib/schema.sql (idempotent)
    npm run db:reset -- --host <neon endpoint id>     # DROP everything + re-apply (archive first!)
    npm run gen-slots [-- --seed <hex>]               # once per database; prints + stores the seed
    npm run issue-tokens -- --n 5 --batch W1          # CSV participant_id,link to stdout (only copy of the tokens)
    npm run issue-tokens -- --n 1 --batch W1 --test --stance direct --modality text
    npm run sweep                                     # expire / abandon now (also done lazily)
    npm run test:assign -- --host <dev endpoint id>   # concurrent assignment + return + claim test
    npm run test:flow -- --host <dev endpoint id>     # end-to-end participant API test (1 LLM call)
Destructive scripts refuse to run unless `--host` names the endpoint `DATABASE_URL` points at.

## Setup
1. Vercel project → Storage → **Neon Postgres** (sets `DATABASE_URL`). Locally, `.env` points at the
   Neon `dev` branch; all development and rehearsals run there.
2. Env vars: `OPENAI_API_KEY`, `RESEARCHER_PASSWORD`, `STUDY1_BASE_URL` (link base for issue-tokens).
   Audio chunks (off by default): `AUDIO_UPLOAD_ENABLED=true`, a private Vercel Blob store
   (`BLOB_READ_WRITE_TOKEN`), optional `BLOB_PREFIX` to separate environments.
3. `npm i`, `npm run db:init`, `npm run gen-slots`.

## Local dev
    npx vercel dev        # serves static + /api on http://localhost:3000
