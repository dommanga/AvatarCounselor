-- Study 1 (online) schema. Idempotent: `npm run db:init` can be re-run safely.
-- No personal data: a participant is only a participant_id (S1-001) and a link token. The link to
-- names/contacts lives in the researcher's spreadsheet, never here.

-- Condition sequence: SLOT_BLOCKS blocks x 6 cells (stance x modality), each block a seeded permutation.
-- Generated once by scripts/gen-slots.js; the seed makes it reproducible.
CREATE TABLE IF NOT EXISTS slot_meta (
  id           int PRIMARY KEY CHECK (id = 1),
  seed         text NOT NULL,
  block_size   int NOT NULL,
  blocks       int NOT NULL,
  algorithm    text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS slots (
  seq      int PRIMARY KEY,                -- 1..block_size*blocks, assignment order
  block    int NOT NULL,
  stance   text NOT NULL CHECK (stance IN ('reversing', 'minimizing', 'direct')),
  modality text NOT NULL CHECK (modality IN ('text', 'voice'))
);

-- One row per issued link token. Lifecycle:
--   issued -> opened -> consented -> in_progress -> completed | expired | abandoned | locked
CREATE TABLE IF NOT EXISTS sessions (
  id                uuid PRIMARY KEY,
  participant_id    text NOT NULL UNIQUE,   -- S1-001 (real) / T1-001 (test)
  batch_id          text NOT NULL,          -- issuing week, e.g. W1
  is_test           boolean NOT NULL DEFAULT false,
  token_hash        text NOT NULL UNIQUE,   -- sha256 of the link token; the token itself is never stored
  status            text NOT NULL DEFAULT 'issued'
                    CHECK (status IN ('issued', 'opened', 'consented', 'in_progress', 'completed', 'expired', 'abandoned', 'locked')),
  issued_at         timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,   -- only applies before consent
  opened_at         timestamptz,
  consented_at      timestamptz,
  completed_at      timestamptz,
  ended_at          timestamptz,            -- when it became expired / abandoned / locked / completed
  stance            text CHECK (stance IN ('reversing', 'minimizing', 'direct')),  -- NULL until consent (test: preset)
  modality          text CHECK (modality IN ('text', 'voice')),
  current_stage     text NOT NULL DEFAULT 'consent',
  resume_count      int NOT NULL DEFAULT 0,
  retry_used        boolean NOT NULL DEFAULT false,  -- the one re-answer chance (empty answer or resume)
  retry_granted_at  timestamptz,
  active_client_key text,                   -- the one browser tab allowed to drive this session
  client_seen_at    timestamptz,
  client_released   boolean NOT NULL DEFAULT false,
  last_activity_at  timestamptz,
  valid             boolean,                -- set on completion: true only if every attention check (AT1, AT2) is correct
  lock_reason       text CHECK (lock_reason IN ('resume_limit', 'empty_answer', 'admin')),
  consent_withdraw_data text CHECK (consent_withdraw_data IN ('use', 'destroy')), -- consent form §8: on withdrawal
  consent_notify    text CHECK (consent_notify IN ('yes', 'no')),               -- consent form §11: new information
  survey_order      jsonb,                  -- {phase: {block: [item ids in the order shown]}}, drawn at consent
  debriefed_at      timestamptz,            -- debriefing confirmed (after completion)
  destroy_pending   boolean NOT NULL DEFAULT false, -- chose 'destroy' and ended without completing; scripts/purge-withdrawn.js
  data_purged_at    timestamptz,
  audio_verified_at timestamptz,            -- transcripts checked against the audio; audio may now be destroyed
  audio_purged_at   timestamptz,            -- scripts/purge-audio.js deleted the audio blobs
  config            jsonb,                  -- settings snapshot at consent (model, temperatures, prompt hashes, ...)
  survey_version    text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Every claim of a session by a browser tab (first open, reload, resume, rejected second window).
CREATE TABLE IF NOT EXISTS session_clients (
  id          bigserial PRIMARY KEY,
  session_id  uuid NOT NULL REFERENCES sessions(id),
  client_key  text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('first', 'reload', 'takeover', 'resume', 'other_window', 'locked')),
  user_agent  text,
  screen      jsonb,                        -- {w, h, vw, vh, dpr}
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS session_clients_session_idx ON session_clients (session_id, id);

-- One row per assignment of a slot to a session. A returned row (returned_at set) waits in the refill
-- queue until a later assignment points at it through refill_of.
CREATE TABLE IF NOT EXISTS slot_assignments (
  id            bigserial PRIMARY KEY,
  slot_seq      int NOT NULL REFERENCES slots(seq),
  session_id    uuid NOT NULL UNIQUE REFERENCES sessions(id),
  source        text NOT NULL CHECK (source IN ('sequence', 'refill')),
  refill_of     bigint REFERENCES slot_assignments(id),
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  returned_at   timestamptz,
  return_reason text CHECK (return_reason IN ('abandoned', 'locked', 'expired', 'invalid', 'admin')),
  exposed       boolean,                    -- had feedback_shown before the return
  CHECK ((source = 'refill') = (refill_of IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS slot_assignments_sequence_key ON slot_assignments (slot_seq) WHERE source = 'sequence';
CREATE UNIQUE INDEX IF NOT EXISTS slot_assignments_refill_key ON slot_assignments (refill_of) WHERE refill_of IS NOT NULL;

-- Append-only. id is generated on the client so a retried POST is deduplicated.
CREATE TABLE IF NOT EXISTS events (
  id          uuid PRIMARY KEY,
  seq         bigserial,
  session_id  uuid NOT NULL REFERENCES sessions(id),
  type        text NOT NULL,
  question_id text,                         -- QUESTION_SEQUENCE id, NULL otherwise
  client_ts   bigint,                       -- Date.now() on the participant device (timing measures use this)
  server_ts   timestamptz NOT NULL DEFAULT clock_timestamp(),
  data        jsonb                         -- small per-event payload (auto_started, mic test text, tab stage, ...)
);
CREATE INDEX IF NOT EXISTS events_session_idx ON events (session_id, seq);

-- One row per submission (practice included). Feedback is generated once: at most one 'pending' or
-- 'done' row per question; 'error' / 'stale' rows are kept for debugging.
CREATE TABLE IF NOT EXISTS answers (
  id               bigserial PRIMARY KEY,
  session_id       uuid NOT NULL REFERENCES sessions(id),
  question_id      text NOT NULL,           -- practice | QUESTION_SEQUENCE id
  attempt          int NOT NULL DEFAULT 1,
  transcript       text NOT NULL,
  answer_truncated boolean NOT NULL DEFAULT false, -- built from the saved segments after an interruption
  answer_short     boolean NOT NULL DEFAULT false, -- under EMPTY_ANSWER_MIN_CHARS after the re-answer chance was used
  client_transcript text,                   -- what the browser's STT had at submit (to spot lost segments)
  injected         boolean NOT NULL DEFAULT false, -- dev-mode corpus injection (test sessions only)
  status           text NOT NULL CHECK (status IN ('pending', 'done', 'error', 'stale')),
  stance           text,
  model            text,
  stage1_raw       text,
  scores           jsonb,                   -- {situation:{rating,quote}, task_and_action:{…}, result:{…}}
  strong           text,
  weak             text,
  context          text,
  stage2_raw       text,                    -- GROUNDING + FEEDBACK
  feedback         text,                    -- FEEDBACK part, as shown to the participant
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz
);
CREATE INDEX IF NOT EXISTS answers_session_idx ON answers (session_id, question_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS answers_live_key ON answers (session_id, question_id)
  WHERE status IN ('pending', 'done') AND question_id <> 'practice';

-- Finalized STT segments saved while the participant is still answering.
CREATE TABLE IF NOT EXISTS answer_segments (
  session_id  uuid NOT NULL REFERENCES sessions(id),
  question_id text NOT NULL,
  attempt     int NOT NULL,
  seq         int NOT NULL,
  text        text NOT NULL,
  client_ts   bigint,
  server_ts   timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (session_id, question_id, attempt, seq)
);

-- Recorded audio chunks (bytes live in a private Vercel Blob store; this is the index). The rows stay
-- after the blobs are destroyed (purged_at).
CREATE TABLE IF NOT EXISTS audio_chunks (
  session_id  uuid NOT NULL REFERENCES sessions(id),
  question_id text NOT NULL,
  attempt     int NOT NULL,
  seq         int NOT NULL,
  pathname    text NOT NULL,
  bytes       int NOT NULL,
  mime        text,
  client_ts   bigint,
  server_ts   timestamptz NOT NULL DEFAULT clock_timestamp(),
  purged_at   timestamptz,
  PRIMARY KEY (session_id, question_id, attempt, seq)
);

-- Survey responses (phase: pre-survey, mid = self-rating before the feedback, post-survey).
CREATE TABLE IF NOT EXISTS responses (
  session_id uuid NOT NULL REFERENCES sessions(id),
  phase      text NOT NULL CHECK (phase IN ('pre', 'mid', 'post')),
  scale_id   text NOT NULL,                 -- the item's scale (ISE, SMI, SA, FPQ, ...)
  block_id   text NOT NULL,                 -- survey_items.json block, to resume at the first unsaved block
  item_id    text NOT NULL,
  value      jsonb NOT NULL,                -- raw score as given; reverse coding happens at analysis
  display_order int,                        -- 1-based position the item was shown at
  shown_text text,                          -- the wording actually shown, for items whose text depends on earlier answers (OE1)
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, phase, item_id)
);

-- Every issue / open / consent / assignment / return / lock, by the system, scripts or (Phase 5) admin.
CREATE TABLE IF NOT EXISTS audit_log (
  id         bigserial PRIMARY KEY,
  ts         timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor      text NOT NULL,                 -- system | script | admin
  action     text NOT NULL,
  session_id uuid REFERENCES sessions(id),
  slot_seq   int,
  detail     jsonb
);
CREATE INDEX IF NOT EXISTS audit_log_session_idx ON audit_log (session_id, id);
