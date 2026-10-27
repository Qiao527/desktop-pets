"use strict";

// Pure view-model for the Insights window, derived from stored history.

const { CATEGORIES, localDayKey, emptyDay } = require("./tracker");

function addDays(ms, n) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12).getTime();
}

function sumTotals(totals) {
  return CATEGORIES.reduce((acc, c) => acc + (totals[c] || 0), 0);
}

/**
 * @param {object} days   history.days (may include unsaved deltas merged in)
 * @param {number} nowMs
 * @param {number} span   number of days in the trend, ending today
 */
function summarizeHistory(days, nowMs, span = 7) {
  const todayKey = localDayKey(nowMs);
  const today = days[todayKey] || emptyDay();

  const trend = [];
  for (let i = span - 1; i >= 0; i--) {
    const key = localDayKey(addDays(nowMs, -i));
    const d = days[key] || emptyDay();
    trend.push({ date: key, totalsMs: { ...d.totalsMs }, trackedMs: sumTotals(d.totalsMs) });
  }

  const focusedMs = (t) => t.typing + t.listening + t.agent;
  const daysWithData = trend.filter((d) => d.trackedMs > 0);
  const avgFocusedMs = daysWithData.length
    ? Math.round(daysWithData.reduce((a, d) => a + focusedMs(d.totalsMs), 0) / daysWithData.length)
    : 0;

  let peakHour = null;
  let peakMs = 0;
  for (let h = 0; h < 24; h++) {
    const ms = today.hourlyMs.typing[h] + today.hourlyMs.listening[h] + today.hourlyMs.agent[h];
    if (ms > peakMs) { peakMs = ms; peakHour = h; }
  }

  return {
    categories: CATEGORIES.slice(),
    today: {
      date: todayKey,
      totalsMs: { ...today.totalsMs },
      trackedMs: sumTotals(today.totalsMs),
      hourlyMs: Object.fromEntries(CATEGORIES.map((c) => [c, today.hourlyMs[c].slice()])),
      peakHour,
    },
    trend,
    avgFocusedMs,
    storedDays: Object.keys(days).length,
  };
}

module.exports = { summarizeHistory };
