// Participant-device side of /api/session/*: link token, per-tab client key, authed calls, an ordered
// retrying event queue, and retried uploads for STT segments and audio chunks.
// Each event carries a client-generated id, so a retried POST is a no-op; segments and chunks are
// keyed by (attempt, seq) on the server, so a repeated upload is a no-op too.

const TOKEN_PATH = /^\/s\/([A-Za-z0-9_-]{20,})\/?$/;
const CLIENT_KEY = "study1.clientKey";

// The participant link is /s/{token}; the token is read from the URL on every load.
export function getToken() {
  return TOKEN_PATH.exec(location.pathname)?.[1] ?? null;
}

// One random key per browser tab: sessionStorage is per tab and survives reloads, so the server can
// tell a reload of the session's tab from a second window.
function getClientKey() {
  try {
    let k = sessionStorage.getItem(CLIENT_KEY);
    if (!k) { k = crypto.randomUUID(); sessionStorage.setItem(CLIENT_KEY, k); }
    return k;
  } catch {
    return crypto.randomUUID(); // storage blocked: every load looks like a new tab
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isClientError = (e) => e.status >= 400 && e.status < 500;

// onAuthError: unknown token (401). onBlocked(screen): another tab holds the session (409) or it has
// ended (410) — screen is other_window | expired | completed | abandoned | locked | locked_error.
export function createSessionClient(token, { onAuthError, onBlocked } = {}) {
  const clientKey = getClientKey();
  const headers = (extra = {}) => ({ authorization: `Bearer ${token}`, "x-client-key": clientKey, ...extra });

  async function call(method, path, body, { quiet = false } = {}) {
    const r = await fetch(path, {
      method,
      headers: headers(body ? { "content-type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (!quiet) {
        if (r.status === 401) onAuthError?.();
        if (r.status === 409 || r.status === 410) onBlocked?.(data.screen || "other_window");
      }
      throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status, screen: data.screen });
    }
    return data;
  }

  // ---------- events: ordered, retried ----------
  const queue = [];
  let flushing = false;
  let closed = false;

  async function flush() {
    if (flushing) return;
    flushing = true;
    let delay = 500;
    while (queue.length) {
      try {
        await call("POST", "/api/session/event", queue[0]);
        queue.shift();
        delay = 500;
      } catch (e) {
        if (isClientError(e)) {
          console.error("[event] rejected, dropped:", queue.shift(), e.message); // retrying can't help
        } else {
          await sleep(delay); // network / server error: keep order, back off, retry
          delay = Math.min(delay * 2, 8000);
        }
      }
    }
    flushing = false;
  }

  async function drainEvents(timeoutMs) {
    const until = Date.now() + timeoutMs;
    while ((queue.length || flushing) && Date.now() < until) await sleep(100);
    return !queue.length && !flushing;
  }

  // ---------- segments + audio chunks: independent retried jobs ----------
  const uploads = new Set();

  function upload(job) {
    const p = (async () => {
      let delay = 500;
      for (let tries = 0; tries < 8; tries++) {
        try { return await job(); } catch (e) {
          if (isClientError(e)) { console.error("[upload] rejected:", e.message); return; }
          await sleep(delay);
          delay = Math.min(delay * 2, 8000);
        }
      }
      console.error("[upload] gave up after retries");
    })().finally(() => uploads.delete(p));
    uploads.add(p);
    return p;
  }

  // Waits for the queued uploads; false if some are still pending after timeoutMs.
  async function flushUploads(timeoutMs) {
    await Promise.race([Promise.allSettled([...uploads]), sleep(timeoutMs)]);
    return uploads.size === 0;
  }

  return {
    state: () => call("GET", "/api/session/state"),
    claim: () => call("POST", "/api/session/claim", {
      user_agent: navigator.userAgent,
      screen: { w: screen.width, h: screen.height, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio },
    }),
    consent: (choices) => call("POST", "/api/session/consent", { agree: true, ...choices }),
    heartbeat: () => call("POST", "/api/session/heartbeat", {}),
    // pagehide: keepalive lets the request outlive the page; lets a new tab take over immediately
    release() {
      fetch("/api/session/release", { method: "POST", keepalive: true, headers: headers({ "content-type": "application/json" }), body: "{}" }).catch(() => {});
    },
    // confirms the answer from the segments the server saved; the feedback starts generating at once
    answer: (question_id, body = {}) => call("POST", "/api/session/answer", { question_id, ...body }),
    feedback: (question_id) => call("GET", `/api/session/feedback?question_id=${encodeURIComponent(question_id)}`),
    survey: (phase, block, answers) => call("POST", "/api/session/survey", { phase, block, answers }),
    // the spoken feedback (voice condition) as a Blob; sent with the client key, so only this tab gets it
    async feedbackAudio(question_id) {
      const r = await fetch(`/api/session/feedback_audio?question_id=${encodeURIComponent(question_id)}`, { headers: headers() });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        if (r.status === 401) onAuthError?.();
        if (r.status === 409 || r.status === 410) onBlocked?.(data.screen || "other_window");
        throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status });
      }
      return r.blob();
    },

    segment: (question_id, attempt, seq, text) =>
      upload(() => call("POST", "/api/session/segment", { question_id, attempt, seq, text, client_ts: Date.now() })),
    audioChunk: (question_id, attempt, seq, blob) =>
      upload(async () => {
        const qs = new URLSearchParams({ question_id, attempt: String(attempt), seq: String(seq), client_ts: String(Date.now()) });
        const r = await fetch(`/api/session/audio?${qs}`, {
          method: "POST", headers: headers({ "content-type": blob.type || "audio/webm" }), body: blob,
        });
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          if (r.status === 403) return; // audio upload is switched off on the server
          throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status });
        }
      }),
    flushUploads,

    // client_ts is taken right here, at the moment of the user action (ts overrides it)
    log(type, question_id = null, { data = null, ts = Date.now() } = {}) {
      if (closed) return; // after completion the server takes no more events
      queue.push({ id: crypto.randomUUID(), type, question_id, client_ts: ts, ...(data && { data }) });
      flush();
    },
    pendingEvents: () => queue.length,

    // The completing event is sent directly and awaited, so the page moves on only once the server has
    // completed the session. -> { participant_id }
    async complete() {
      await drainEvents(15000);
      const body = { id: crypto.randomUUID(), type: "survey_post_submitted", question_id: null, client_ts: Date.now() };
      let lastError;
      for (let tries = 0; tries < 3; tries++) {
        try { return await call("POST", "/api/session/event", body, { quiet: true }); } catch (e) {
          // 410 'completed' on a retry means the first attempt did go through
          if (e.status === 410 && e.screen === "completed") return {};
          if (isClientError(e)) throw e;
          lastError = e;
          await sleep(1000);
        }
      }
      throw lastError;
    },
    close() { closed = true; },
    debrief: (kind) => call("POST", "/api/session/debrief", { kind, id: crypto.randomUUID(), client_ts: Date.now() }),
  };
}
