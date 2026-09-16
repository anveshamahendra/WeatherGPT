// ==========================================================================
// WeatherGPT — Risk & confidence logic (extracted for auditability)
//
// These functions implement the "never fabricates" / "warning-first" claims.
// They are pure — no DOM access, no network calls, no side effects.
// ==========================================================================

import { resolveTimeWindow, addDaysToDateStr, mean, spread } from './utils.js';

/** Select hourly entries matching the given time window key. */
export function selectWindowHours(forecast, timeKey) {
  const rule = resolveTimeWindow(timeKey);
  const baseDate = forecast.hourly[0].time.slice(0, 10);
  const targetDate = addDaysToDateStr(baseDate, rule.dayOffset);
  if (timeKey === 'now') {
    const hours = forecast.hourly.filter((h) => h.time.slice(0, 10) === targetDate);
    return { hours: hours.slice(0, 1), rule, targetDate };
  }
  const hours = forecast.hourly.filter((h) => {
    const d = h.time.slice(0, 10);
    const hr = Number(h.time.slice(11, 13));
    return d === targetDate && hr >= rule.hourStart && hr < rule.hourEnd;
  });
  return { hours, rule, targetDate };
}

/** Compute multi-model confidence for a given field across selected hours. */
export function computeConfidence(hours, field) {
  const spreads = hours.map((h) => spread(h.models[field] || []));
  const avgSpread = mean(spreads) || 0;
  let level, label;
  const thresholds = field === 'temperature' ? [1.5, 3.5] : [15, 35];
  if (avgSpread <= thresholds[0]) { level = 'high'; label = 'High'; }
  else if (avgSpread <= thresholds[1]) { level = 'moderate'; label = 'Moderate'; }
  else { level = 'low'; label = 'Low'; }
  return { level, label, avgSpread };
}

/** Classify a set of hourly entries into a risk tier. */
export function riskLevelFor(hours, daily) {
  const maxPop = Math.max(0, ...hours.map((h) => h.pop ?? 0));
  const maxPrecip = hours.reduce((a, h) => a + (h.precipitation ?? 0), 0);
  const maxWind = Math.max(0, ...hours.map((h) => h.windSpeed ?? 0));
  const maxTemp = Math.max(0, ...hours.map((h) => h.temperature ?? 0));
  if (maxPrecip >= 65 || maxWind >= 62 || maxTemp >= 45) return { level: 'danger', label: 'Orange-level risk', maxPop, maxPrecip, maxWind, maxTemp };
  if (maxPrecip >= 30 || maxPop >= 70 || maxWind >= 40 || maxTemp >= 42) return { level: 'warning', label: 'Yellow-level risk', maxPop, maxPrecip, maxWind, maxTemp };
  return { level: 'success', label: 'No elevated risk', maxPop, maxPrecip, maxWind, maxTemp };
}

/** Escape HTML special characters — only guard between IMD free text and the DOM. */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
