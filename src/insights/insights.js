// Activity Insights renderer. Runs sandboxed; talks to main only through
// window.insights (src/preload-insights.js). Builds DOM with textContent and
// CSSOM only (never HTML strings), so stored data can never inject markup.
"use strict";

const LABELS = {
  typing: "Typing",
  listening: "Listening",
  agent: "AI agent",
  idle: "Idle",
  sleeping: "Away",
};
const DETECTOR_LABELS = { textFocus: "Text input focus", media: "Media playback" };
const STATUS = {
  ok: ["OK", "ok"],
  starting: ["Starting", "idle"],
  stopped: ["Paused", "idle"],
  degraded: ["Retrying", "warn"],
  "permission-denied": ["Needs permission", "bad"],
};
const REFRESH_MS = 5000;

const $ = (id) => document.getElementById(id);
let state = null;
let busy = false;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "style") Object.assign(node.style, v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

function fmtDuration(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return ms > 0 ? "<1m" : "0m";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

function fmtDay(key, todayKey) {
  if (key === todayKey) return "Today";
  const [y, mo, d] = key.split("-").map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function fmtAgo(ms) {
  if (!ms) return "—";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function color(cat) {
  return `var(--c-${cat})`;
}

function stackBar(totals, categories, small = false) {
  const sum = categories.reduce((a, c) => a + totals[c], 0);
  const bar = el("div", { class: small ? "stack small" : "stack", role: "img" });
  const parts = [];
  for (const c of categories) {
    if (!totals[c]) continue;
    bar.append(el("span", { style: { width: `${(totals[c] / sum) * 100}%`, background: color(c) } }));
    parts.push(`${LABELS[c]} ${fmtDuration(totals[c])}`);
  }
  bar.setAttribute("aria-label", parts.length ? parts.join(", ") : "No data");
  return bar;
}

function focused(t) {
  return t.typing + t.listening + t.agent;
}

function renderToday(summary) {
  const { today, categories } = summary;
  $("today-now").textContent = state.currentCategory && state.tracking.enabled ? `Now: ${LABELS[state.currentCategory]}` : "";
  const stats = $("today-stats");
  stats.replaceChildren(
    ...[
      [fmtDuration(focused(today.totalsMs)), "Focused (typing, listening, agent)"],
      [fmtDuration(today.totalsMs.typing), "Typing"],
      [fmtDuration(today.trackedMs), "Tracked in total"],
    ].map(([v, l]) => el("div", {}, [el("div", { class: "stat-value", text: v }), el("div", { class: "stat-label", text: l })])),
  );
  $("today-bar").replaceWith(Object.assign(stackBar(today.totalsMs, categories), { id: "today-bar" }));
  $("legend").replaceChildren(
    ...categories.map((c) => el("li", {}, [
      el("span", { class: "swatch", style: { background: color(c) }, "aria-hidden": "true" }),
      el("span", { text: `${LABELS[c]} ${fmtDuration(today.totalsMs[c])}` }),
    ])),
  );
}

function renderHours(summary) {
  const { today, categories } = summary;
  const chart = $("hour-chart");
  const perHour = Array.from({ length: 24 }, (_, h) => categories.reduce((a, c) => a + today.hourlyMs[c][h], 0));
  const max = Math.max(3600000, ...perHour);
  const described = [];
  chart.replaceChildren(
    ...perHour.map((total, h) => {
      const col = el("div", { class: "hour-col", title: `${h}:00 — ${fmtDuration(total)}` });
      for (const c of categories) {
        const v = today.hourlyMs[c][h];
        if (v) col.append(el("span", { style: { height: `${(v / max) * 100}%`, background: color(c) } }));
      }
      if (total) described.push(`${h}:00 ${fmtDuration(total)}`);
      return col;
    }),
  );
  chart.setAttribute("aria-label", described.length ? `Tracked time by hour: ${described.join(", ")}` : "No tracked time today");
  $("peak-hour").textContent = today.peakHour === null ? "" : `Most focused around ${today.peakHour}:00`;
}

function renderWeek(summary) {
  const body = $("week-table").tBodies[0];
  const rows = summary.trend.slice().reverse().map((d) => {
    const tr = el("tr", { class: d.date === summary.today.date ? "today" : "" });
    tr.append(
      el("td", { text: fmtDay(d.date, summary.today.date) }),
      el("td", {}, [d.trackedMs ? stackBar(d.totalsMs, summary.categories, true) : el("span", { class: "muted", text: "No data" })]),
      el("td", { class: "num", text: fmtDuration(focused(d.totalsMs)) }),
      el("td", { class: "num", text: fmtDuration(d.trackedMs) }),
    );
    return tr;
  });
  body.replaceChildren(...rows);
  $("week-avg").textContent = summary.avgFocusedMs ? `Average focused: ${fmtDuration(summary.avgFocusedMs)} / day` : "";
}

function renderHealth() {
  const body = $("health-table").tBodies[0];
  const help = $("permission-help");
  if (!state.platformSupported) {
    body.replaceChildren(el("tr", {}, [el("td", { colspan: "4", class: "muted", text: "Activity detection is available on macOS only." })]));
    help.hidden = true;
    return;
  }
  const paused = state.pauseReasons.length > 0;
  $("health-note").textContent = paused ? `Paused while ${state.pauseReasons.join(" and ")}` : "";
  body.replaceChildren(...state.detectors.map((d) => {
    const [label, tone] = STATUS[d.status] || [d.status, "idle"];
    const lat = d.latencyMs && d.latencyMs.p50 !== null ? `${d.latencyMs.p50} / ${d.latencyMs.p95} ms` : "—";
    return el("tr", {}, [
      el("td", { text: DETECTOR_LABELS[d.name] || d.name }),
      el("td", {}, [el("span", { class: `pill ${tone}`, text: d.status === "degraded" && d.lastErrorKind ? `${label} (${d.lastErrorKind})` : label })]),
      el("td", { class: "num", text: lat }),
      el("td", { text: fmtAgo(d.lastSuccessAt) }),
    ]);
  }));

  const denied = state.detectors.filter((d) => d.status === "permission-denied");
  help.hidden = denied.length === 0;
  if (denied.length) {
    const children = [el("p", { text: "macOS has not granted the access this detector needs. The pet keeps working; this reading stays off until access is granted." })];
    if (denied.some((d) => d.name === "textFocus")) {
      children.push(el("button", { "data-pane": "accessibility", text: "Open Accessibility settings" }));
    }
    if (denied.some((d) => d.name === "media")) {
      children.push(document.createTextNode(" "), el("button", { "data-pane": "automation", text: "Open Automation settings" }));
    }
    help.replaceChildren(...children);
  }
}

function render() {
  const main = $("main");
  main.setAttribute("aria-busy", "false");
  const { tracking, summary } = state;
  const toggle = $("tracking-toggle");
  toggle.disabled = busy || !state.platformSupported || tracking.readOnly;
  toggle.setAttribute("aria-checked", String(tracking.enabled));

  $("subtitle").textContent = !state.platformSupported
    ? "Activity detection requires macOS."
    : tracking.enabled ? "Tracking is on — everything stays on this Mac."
      : summary && summary.storedDays > 0 ? "Tracking is off — showing saved history." : "Tracking is off.";

  const banner = $("banner");
  const notes = [];
  if (tracking.readOnly) notes.push("The history file was written by a newer version of Desktop Pets, so it is shown read-only.");
  if (tracking.recoveredFrom === "backup") notes.push("The history file was damaged and has been restored from its last good backup.");
  if (tracking.recoveredFrom === "empty") notes.push("The history file was damaged and could not be recovered; a fresh history was started. The damaged file was kept aside.");
  if (tracking.loadError && !tracking.readOnly && !tracking.recoveredFrom) notes.push(`Could not read history: ${tracking.loadError}`);
  banner.hidden = notes.length === 0;
  banner.textContent = notes.join(" ");

  const hasData = !!(summary && summary.storedDays > 0);
  $("empty").hidden = tracking.enabled || hasData || !state.platformSupported;
  for (const id of ["today", "hours", "week"]) $(id).hidden = !summary || (!tracking.enabled && !hasData);
  if (summary) { renderToday(summary); renderHours(summary); renderWeek(summary); }
  renderHealth();

  $("storage-path").textContent = hasData || tracking.enabled
    ? `Stored locally in ${tracking.file}`
    : "No activity data is stored.";
  $("delete-btn").disabled = busy || (!hasData && !tracking.enabled);
}

function showError(err) {
  const banner = $("banner");
  banner.hidden = false;
  banner.textContent = `Something went wrong: ${err && err.message ? err.message : err}`;
}

async function refresh() {
  try {
    state = await window.insights.getState();
    render();
  } catch (err) {
    showError(err);
  }
}

async function act(fn) {
  if (busy) return;
  busy = true;
  if (state) render();
  try {
    state = await fn();
  } catch (err) {
    showError(err);
  } finally {
    busy = false;
    if (state) render();
  }
}

$("tracking-toggle").addEventListener("click", () => act(() => window.insights.setTracking(!state.tracking.enabled)));
$("enable-cta").addEventListener("click", () => act(() => window.insights.setTracking(true)));
$("delete-btn").addEventListener("click", () => {
  $("delete-btn").hidden = true;
  $("delete-confirm").hidden = false;
  $("delete-no").focus();
});
$("delete-no").addEventListener("click", () => {
  $("delete-confirm").hidden = true;
  $("delete-btn").hidden = false;
  $("delete-btn").focus();
});
$("delete-yes").addEventListener("click", async () => {
  $("delete-confirm").hidden = true;
  $("delete-btn").hidden = false;
  await act(() => window.insights.deleteAll());
  $("delete-btn").focus();
});
$("permission-help").addEventListener("click", (e) => {
  const pane = e.target && e.target.getAttribute && e.target.getAttribute("data-pane");
  if (pane) window.insights.openSettings(pane).catch(showError);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("delete-confirm").hidden) $("delete-no").click();
});

refresh();
setInterval(() => { if (document.visibilityState === "visible" && !busy) refresh(); }, REFRESH_MS);
