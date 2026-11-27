# Study 1 — AI interview coach (online experiment)

Static frontend + Vercel serverless functions + Neon Postgres. No personal data in the database:
participants are a participant_id (`S1-001`) and a link token; the mapping to people lives only in the
researcher's spreadsheet.

## Pages
- `/s/{token}` — participant flow:
  browser check → consent → device test (speaker chime that loops until [정지], microphone) → pre-survey → notice →
  scenario → answer instructions → Q2 (40 s thinking time from the moment the question appears, answer) →
  self-rating → loading → feedback → post-survey → debriefing → completion (payment form link).
  Leaving the question screen resumes at the answer instructions; the countdown starts over.
  The browser check (desktop Chrome with speech recognition + recording) runs before any API call, so an
  unsupported browser leaves the link untouched. Expired / locked links and a second window get notice screens.
- `/` without a token asks for the participant link.

## Endpoints
- `GET /api/session/state`, `POST /api/session/{claim,heartbeat,release,consent,event,survey,answer,segment,audio,debrief}`,
  `GET /api/session/feedback` — link token as bearer + `X-Client-Key` (one active tab per session);
  see the header of `api/session/[action].js`
- `POST /api/researcher/{login,logout}` — researcher cookie
- `POST /api/assess`, `POST /api/feedback` — dev "API 테스트" view only; researcher login required

`prompts.js` is auto-generated from `experiment/prompts/*.md`. Regenerate if prompts change.

## Wording and timing
- All participant-facing text is in `src/copy.js` (static page text is bound with `data-copy`, lists with `data-copy-list`).
  The question text the LLM receives is `QUESTIONS` (src/questions.js); the hint shown under it (`COPY.questionHints`)
  is screen-only and test-flow checks that it never reaches an LLM request. Survey items:
  `survey_items.json`. Consent text: placeholder in `COPY.consentBody`.
- Timing values are in `lib/config.js` (`THINK_TIME_MS`, `ANSWER_MAX_MS`, `FEEDBACK_MIN_WAIT_MS`, `LOADING_TIMEOUT_MS`,
  `AUDIO_CHUNK_MS`) and are copied into each session's `config` snapshot.
- The feedback is revealed at `max(ready, answer submitted + FEEDBACK_MIN_WAIT_MS)` (the answer counts from the server's
  confirmation; 0 = as soon as it is ready). `feedback_timing` records per question: submitted / ready / revealed times,
  the time from submit to reveal, how long the page held the loading screen, and the min wait it was told.
  A loading screen longer than `LOADING_TIMEOUT_MS` shows the "ask the researcher" message and logs `client_timeout`.
- Survey items: `survey_items.json` (version in `sessions.survey_version`). Blocks run in a fixed order; items inside a
  block are shown in a per-session random order drawn at consent (`sessions.survey_order`) — only within their
  `group` (SMI: like-to-hear / want-to-discover; FPQ: usefulness / affect), `"fixed": true` items (AT1, AT2) keep their
  position, and `"shuffle": false` blocks (pre_background, post_oe) keep the config order. Every response stores
  `display_order`, `scale_id` and `block_id`. Scores are stored raw; `"reverse": true` items are recoded at analysis.
- Text in the config supports `**bold**`. OE1's wording depends on SA_pre / SA_post (`conditional`); the wording shown is
  stored in `responses.shown_text`. Open-ended answers need `OE_MIN_CHARS` (lib/config.js) characters.
- `npm run codebook` writes `codebook.csv` (one row per item: scale, subscale, group, range, anchors, reverse, check,
  fixed, ...) from `survey_items.json`; `npm run codebook -- --check` fails if the committed file is stale.

## Answering and feedback
- While answering, STT final results are saved as segments and audio is uploaded in 5 s chunks; nothing is
  shown to the participant but a volume meter. The server confirms the answer from the saved segments and starts
  generating the feedback at once (it keeps running after the response); the page polls `GET feedback`.
  Feedback is generated once per question and never regenerated for display.
- **Voice condition** (ElevenLabs, `lib/tts.js`, settings in `TTS` in `lib/config.js`): once Stage 2 has produced the
  text the server normalizes it (minimal rules, `tts-text-v1`), synthesizes it (2 retries), stores
  `{env}/{session}/q2/feedback.mp3` in the private Blob store and writes a `feedback_audio` row (text before / after,
  rules, chars, audio seconds, latencies, attempts, model, voice, settings). The answer row stays `pending` until the audio
  exists. If the TTS still fails the session is locked (`tts_error`) and the slot returned unexposed — the text is never
  offered instead. The page gets the audio through `GET feedback_audio` (claim key required) and never any text;
  exposure = `audio_started`. A reload before `audio_ended` plays the stored file again from the start.
- **The TTS model is provisional** (`TTS.modelId`, `modelConfirmed: false`, recorded in each voice session's snapshot).
  `npm run voice-eval` measures the time to feedback (text vs voice) and writes the listening samples
  (`~/dev/study1-voice-samples/<time>/index.html`); set the chosen model in `lib/config.js` and `modelConfirmed: true`.
- Local env for the voice parts: `ELEVENLABS_API_KEY` in `.env.local` (`vercel env pull`), plus Blob credentials.

## Session lifecycle
`issued → opened → consented → in_progress → completed | expired | abandoned | locked`
- Condition (stance × modality) is assigned at consent from a seeded 6-cell block sequence (`slots`);
  slots of abandoned / locked / invalid (failed attention check) sessions are returned and refilled first.
- One resume after consent; the second locks the session. One re-answer chance per session.
- Every issue / assignment / return / lock is in `audit_log`. Settings live in `lib/config.js`.

## /admin (operations screen)
`/admin`, password `RESEARCHER_PASSWORD` (5 wrong tries per IP in 10 minutes lock the login). No personal data: participant ids,
token states, conditions, progress. Four views: participants (filters, detail panel with the timeline, expiry extension, resume,
condition change, payment-form link), issue (same code as `issue-tokens`: `lib/issue.js`; result table + CSV), cells (valid
completions / target, in progress, returned slots before/after exposure, refill queue; emergency slot adjustments), audit log.
- Resume works for locked / abandoned sessions that have **not** met the feedback: a new slot is assigned the normal way, the
  pre-survey answers stay, re-answer chance and resume count start over. Locked after the feedback: no resume.
- Condition change: only active sessions with no answer on file and no exposure. Slot delete: only never-assigned slots.
- Every change needs a reason and is written to `audit_log` (actor `admin`). Test sessions (T1-) are hidden by default.
- The API-test dev view uses the same login cookie.

## Scripts (read `DATABASE_URL` from `.env`)
    npm run db:init                                   # apply lib/schema.sql (idempotent)
    npm run db:reset -- --host <neon endpoint id>     # DROP everything + re-apply (archive first!); main branch: --prod + typed count
    npm run gen-slots -- --host <endpoint> [--seed <hex>]   # once per database; prints + stores the seed; main: --prod + typed count
    npm run issue-tokens -- --n 5 --batch W1          # CSV participant_id,link to stdout (only copy of the tokens)
    npm run issue-tokens -- --n 1 --batch W1 --test --stance direct --modality text
    npm run sweep                                     # expire / abandon now (also done lazily)
    npm run test:assign   # concurrent assignment + return + claim test
    npm run test:flow     # end-to-end participant API test (several LLM calls)
    npm run test:admin    # /admin API: login limit, issue + CSV, cell numbers, resume, condition, slots
    npm run test:survey   # survey definition, ordering, validation, OE1, valid judgement (no LLM)
    npm run test:ui [-- --full] [--audio] [--admin-only]   # headless Chrome: flow + every survey block + voice playback + /admin
    npm run voice-eval [-- --models a,b] [--main <model>]            # 4.5 timing + 4.6 listening samples (calls the real TTS)
    npm run test:assign-http -- --url https://<preview> [--audio] [--voice]
    npm run test:safety                               # guards: tests refuse off the test branch, purge only from a plan
    npm run purge-audio -- --plan                     # list the transcript-verified sessions whose audio would go (writes purge-plans/)
    npm run purge-withdrawn -- --plan                 # list the 'destroy'-choice sessions that ended early whose data would go
    npm run purge-… -- --execute <plan file> --host <endpoint>   # the researcher only; processes exactly that plan
Destructive scripts refuse to run unless `--host` names the endpoint `DATABASE_URL` points at. On the main (production)
branch (any endpoint not listed in `scripts/db-roles.json`) they need `--prod` and the count typed in at a terminal.
Purging has no "everything that qualifies" mode: `--plan` writes the list (session id, participant_id, rows to delete),
`--execute <file>` handles only those sessions and skips (and reports) any whose data changed since.

### Neon branches
- `main`: production. `dev`: the researcher's rehearsals only. `test`: automated tests only.
- Tests (`npm run test:*`) load `.env.test` last (`DATABASE_URL` of the `test` branch, `BLOB_PREFIX=test`) and refuse any other
  database. Register the test branch's endpoint id in `scripts/db-roles.json` (`test`), then once:
  `node --env-file=.env.test scripts/db-init.js` and `node --env-file=.env.test scripts/gen-slots.js --host <test endpoint>`.
- Claude Code may only make plans and dry-runs; `.claude/settings.json` denies the destructive commands and `CLAUDE.md` says why.
The purge scripts never run automatically. Blob access from a local machine needs the store's
connection to include the Development environment (OIDC), or a `BLOB_READ_WRITE_TOKEN`.

## Setup
1. Vercel project → Storage → **Neon Postgres** (sets `DATABASE_URL`). Locally, `.env` points at the
   Neon `dev` branch; all development and rehearsals run there.
2. Env vars: `OPENAI_API_KEY`, `RESEARCHER_PASSWORD`, `STUDY1_BASE_URL` (link base for issue-tokens).
   Audio chunks (off by default): `AUDIO_UPLOAD_ENABLED=true`, a private Vercel Blob store
   (`BLOB_READ_WRITE_TOKEN`), optional `BLOB_PREFIX` to separate environments.
3. `npm i`, `npm run db:init`, `npm run gen-slots`.

## Local dev
    npx vercel dev        # serves static + /api on http://localhost:3000
