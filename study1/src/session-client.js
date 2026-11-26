// Participant-device side of /api/session/*: link token, per-tab client key, authed calls, and an
// ordered, retrying event queue. Each event carries a client-generated id, so a retried POST is a no-op.

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

// onAuthError: unknown token (401). onBlocked(screen): another tab holds the session (409) or it has
// ended (410) — screen is other_window | expired | completed | abandoned | locked.
export function createSessionClient(token, { onAuthError, onBlocked } = {}) {
  const clientKey = getClientKey();
  const headers = (body) => ({
    authorization: `Bearer ${token}`, "x-client-key": clientKey, ...(body && { "content-type": "application/json" }),
  });

  async function call(method, path, body) {
    const r = await fetch(path, { method, headers: headers(body), body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401) onAuthError?.();
      if (r.status === 409 || r.status === 410) onBlocked?.(data.screen || "other_window");
      throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status });
    }
    return data;
  }

  const queue = [];
  let flushing = false;

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
        if (e.status >= 400 && e.status < 500) {
          console.error("[event] rejected, dropped:", queue.shift(), e.message); // retrying can't help
        } else {
          await sleep(delay); // network / server error: keep order, back off, retry
          delay = Math.min(delay * 2, 8000);
        }
      }
    }
    flushing = false;
  }

  return {
    state: () => call("GET", "/api/session/state"),
    claim: () => call("POST", "/api/session/claim", {
      user_agent: navigator.userAgent,
      screen: { w: screen.width, h: screen.height, vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio },
    }),
    consent: () => call("POST", "/api/session/consent", {}),
    heartbeat: () => call("POST", "/api/session/heartbeat", {}),
    // pagehide: keepalive lets the request outlive the page; lets a new tab take over immediately
    release() {
      fetch("/api/session/release", { method: "POST", keepalive: true, headers: headers({}), body: "{}" }).catch(() => {});
    },
    answer: (question_id, transcript, injected = false, from_saved = false) =>
      call("POST", "/api/session/answer", { question_id, transcript, injected, from_saved }),
    survey: (phase, block, answers) => call("POST", "/api/session/survey", { phase, block, answers }),
    // client_ts is taken right here, at the moment of the user action
    log(type, question_id = null) {
      queue.push({ id: crypto.randomUUID(), type, question_id, client_ts: Date.now() });
      flush();
    },
    pendingEvents: () => queue.length,
  };
}
