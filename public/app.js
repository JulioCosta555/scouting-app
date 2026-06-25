// app.js — entry point. Boots the runtime and surfaces load status/errors.
import { boot } from "/loader.js";

const statusEl = document.getElementById("status");

function setStatus(msg, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.style.color = isError ? "#c0392b" : "#888";
  statusEl.style.display = msg ? "block" : "none";
}

setStatus("Loading data and building dashboard\u2026");

boot()
  .then(() => {
    const check = () => {
      const dash = document.querySelector("#dashboard");
      if (dash && dash.childElementCount > 0) setStatus("");
      else setTimeout(check, 400);
    };
    check();
  })
  .catch((err) => {
    console.error(err);
    setStatus("Failed to load: " + err.message, true);
  });
