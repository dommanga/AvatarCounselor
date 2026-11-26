// Participant-device side of /api/session/*: token storage, authed calls, and an ordered,
// retrying event queue. Each event carries a client-generated id, so a retried POST is a no-op.

const TOKEN_KEY = "study1.participantToken";

// sessionStorage: survives reloads in this tab, and /researcher -> / hand-off (same tab, same origin).
export function getToken() {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token) {
  try { sessionStorage.setItem(TOKEN_KEY, token); return true; } catch { return false; }
}
export function clearToken() {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createSessionClient(token, { onAuthError } = {}) {
  async function call(method, path, body) {
    const r = await fetch(path, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body && { "content-type": "application/json" }) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401) onAuthError?.();
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
    answer: (question_id, transcript, injected = false) =>
      call("POST", "/api/session/answer", { question_id, transcript, injected }),
    survey: (phase, block, answers) => call("POST", "/api/session/survey", { phase, block, answers }),
    // client_ts is taken right here, at the moment of the user action
    log(type, question_id = null) {
      queue.push({ id: crypto.randomUUID(), type, question_id, client_ts: Date.now() });
      flush();
    },
    pendingEvents: () => queue.length,
  };
}
