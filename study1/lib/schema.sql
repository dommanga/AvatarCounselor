-- Study 1 main-experiment schema. Idempotent: `npm run db:init` can be re-run safely.

-- Pilot-era assignment sequence (10 blocks x 3 conditions). No longer filled by db-init;
-- condition assignment is redesigned in Phase 2.
CREATE TABLE IF NOT EXISTS block_sequence (
  slot      int  PRIMARY KEY,               -- 1..30
  block     int  NOT NULL,                  -- 1..10
  condition text NOT NULL CHECK (condition IN ('reversing', 'minimizing', 'direct'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id                  uuid PRIMARY KEY,
  participant_id      text NOT NULL,
  condition           text NOT NULL CHECK (condition IN ('reversing', 'minimizing', 'direct')),
  suggested_condition text,                 -- block_sequence condition at creation; differs if overridden
  slot                int REFERENCES block_sequence(slot),   -- NULL for test sessions
  is_test             boolean NOT NULL DEFAULT false,
  token_hash          text NOT NULL,        -- sha256 of the participant-device bearer token
  current_stage       text NOT NULL DEFAULT 'pre_survey',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- added after first deploy; ALTER keeps `npm run db:init` working on an existing database
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS survey_version text;   -- survey_items.json "version" at creation
CREATE UNIQUE INDEX IF NOT EXISTS sessions_slot_key ON sessions (slot) WHERE slot IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_participant_key ON sessions (participant_id) WHERE NOT is_test;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_key ON sessions (token_hash);

-- Append-only. id is generated on the client so a retried POST is deduplicated.
CREATE TABLE IF NOT EXISTS events (
  id          uuid PRIMARY KEY,
  seq         bigserial,
  session_id  uuid NOT NULL REFERENCES sessions(id),
  type        text NOT NULL,
  question_id text,                         -- q1|q2|q3, NULL otherwise
  client_ts   bigint,                       -- Date.now() on the participant device (timing measures use this)
  server_ts   timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS events_session_idx ON events (session_id, seq);

-- One row per submission (practice included, flagged by question_id = 'practice'). Retries after an
-- LLM error add rows; the latest row with feedback IS NOT NULL is the one shown to the participant.
CREATE TABLE IF NOT EXISTS answers (
  id          bigserial PRIMARY KEY,
  session_id  uuid NOT NULL REFERENCES sessions(id),
  question_id text NOT NULL,                -- practice|q1|q2|q3
  transcript  text NOT NULL,
  injected    boolean NOT NULL DEFAULT false, -- dev-mode corpus injection (test sessions only)
  condition   text,
  model       text,
  stage1_raw  text,
  scores      jsonb,                        -- {situation:{rating,quote}, task_and_action:{…}, result:{…}}
  strong      text,
  weak        text,
  context     text,
  stage2_raw  text,                         -- GROUNDING + FEEDBACK
  feedback    text,                         -- FEEDBACK part, as shown to the participant
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS answers_session_idx ON answers (session_id, question_id, id);

-- Phase 2: survey responses.
CREATE TABLE IF NOT EXISTS responses (
  session_id uuid NOT NULL REFERENCES sessions(id),
  phase      text NOT NULL CHECK (phase IN ('pre', 'post')),
  scale_id   text NOT NULL,
  item_id    text NOT NULL,
  value      jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, phase, item_id)
);
