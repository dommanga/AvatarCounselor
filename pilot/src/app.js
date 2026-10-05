import { initParticipantView } from "./participant-view.js";
import { initDevView } from "./dev-view.js";

// Two views: participant flow (default) and the Test API view (v0 inspection tool). A toggle
// switches between them, but the toggle itself is hidden from participants — it only appears
// once dev mode is unlocked with the Cmd/Ctrl+Shift+P shortcut. Dev mode is refused while a real
// (non-test) session is running on this device; the Test API view also needs researcher login.
const participantView = document.getElementById("participantView");
const devView = document.getElementById("devView");
const devToggle = document.getElementById("devToggle");
const devSwitch = document.querySelector(".devswitch");
const devBanner = document.getElementById("devBanner");

initParticipantView(participantView);
initDevView(devView);

function applyView() {
  const dev = devToggle.checked;
  devView.classList.toggle("hidden", !dev);
  participantView.classList.toggle("hidden", dev);
}
devToggle.addEventListener("change", applyView);
applyView(); // default: participant view (toggle off)

// ---------- dev mode: unlocked via keyboard shortcut, off by default ----------
let devMode = false;
let devAllowed = true; // false while a real session is active
window.addEventListener("pilot:session", (e) => {
  devAllowed = !e.detail.active || e.detail.isTest;
  if (!devAllowed && devMode) setDevMode(false);
});
function setDevMode(on) {
  devMode = on;
  devSwitch.classList.toggle("hidden", !on);
  devBanner.classList.toggle("hidden", !on);
  if (!on) { devToggle.checked = false; applyView(); } // locking dev mode always returns to participant view
  window.dispatchEvent(new CustomEvent("pilot:devmode", { detail: { on } }));
}
window.addEventListener("keydown", (e) => {
  if (e.shiftKey && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
    e.preventDefault();
    if (devAllowed || devMode) setDevMode(!devMode);
  }
});
