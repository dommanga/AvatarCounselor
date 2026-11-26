// Study 1 runtime settings (server only). Snapshotted into sessions.config at consent.

export const MODALITIES = ["text", "voice"];

export const SLOT_BLOCK_SIZE = 6;            // stance x modality cells per block
export const SLOT_BLOCKS = 30;               // 180 slots

export const ABANDON_AFTER_MS = 2 * 60 * 60 * 1000; // in-progress session with no activity for this long -> abandoned
export const EMPTY_ANSWER_MIN_CHARS = 10;    // non-whitespace chars; below this an answer counts as empty
export const MAX_RESUMES = 1;                // a second re-entry after consent locks the session
export const HEARTBEAT_MS = 20_000;          // participant tab -> /api/session/heartbeat
export const CLIENT_STALE_MS = 90_000;       // no heartbeat for this long = that tab is gone (background tabs throttle timers to ~1/min)
export const ANSWER_PENDING_STALE_MS = 120_000; // a 'pending' feedback row older than this was orphaned by a dead function

// Answer timing (sent to the page; snapshotted per session).
export const THINK_TIME_MS = 40_000;          // thinking time before recording starts automatically
export const ANSWER_MAX_MS = 120_000;         // the answer is submitted automatically at this length
export const FEEDBACK_MIN_WAIT_MS = 0;        // loading screen stays at least this long (Phase 4 sets it)
export const TEXT_MIN_DWELL_MS_PER_CHAR = 0;  // text feedback: next button waits chars x this (Phase 4 sets it)
export const AUDIO_CHUNK_MS = 5_000;          // MediaRecorder timeslice

export const AUDIO_UPLOAD_ENABLED = process.env.AUDIO_UPLOAD_ENABLED === "true"; // off until IRB/consent covers audio
export const AUDIO_MAX_BYTES = 4 * 1024 * 1024; // under Vercel's 4.5 MB request body limit
