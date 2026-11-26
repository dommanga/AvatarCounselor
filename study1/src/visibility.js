// Logs tab visibility and window focus as events (stage label in the event data) and keeps running
// totals of hidden / unfocused time, so each screen's time away can be worked out from the log and
// the feedback screen's total can be attached to next_clicked.

export function createVisibilityTracker({ log, getStage }) {
  const now = () => performance.now();
  let hiddenSince = document.hidden ? now() : null;
  let blurSince = document.hasFocus() ? null : now();
  let hiddenTotal = 0, blurTotal = 0;
  const emit = (type) => log(type, { stage: getStage() });

  const onVisibility = () => {
    if (document.hidden) { hiddenSince = now(); emit("tab_hidden"); return; }
    if (hiddenSince !== null) hiddenTotal += now() - hiddenSince;
    hiddenSince = null;
    emit("tab_visible");
  };
  const onBlur = () => { blurSince = now(); emit("window_blur"); };
  const onFocus = () => {
    if (blurSince !== null) blurTotal += now() - blurSince;
    blurSince = null;
    emit("window_focus");
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);

  return {
    // totals so far in ms, including a hidden / unfocused stretch that is still going on
    snapshot() {
      const t = now();
      return { hidden: hiddenTotal + (hiddenSince !== null ? t - hiddenSince : 0), blur: blurTotal + (blurSince !== null ? t - blurSince : 0) };
    },
    stop() {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    },
  };
}
