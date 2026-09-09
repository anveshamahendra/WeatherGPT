// ==========================================================================
// WeatherGPT — Utilities
// ==========================================================================

export const WMO = {
  0: { text: 'Clear sky', icon: 'sun' },
  1: { text: 'Mainly clear', icon: 'sun-cloud' },
  2: { text: 'Partly cloudy', icon: 'sun-cloud' },
  3: { text: 'Overcast', icon: 'cloud' },
  45: { text: 'Fog', icon: 'fog' },
  48: { text: 'Depositing rime fog', icon: 'fog' },
  51: { text: 'Light drizzle', icon: 'drizzle' },
  53: { text: 'Moderate drizzle', icon: 'drizzle' },
  55: { text: 'Dense drizzle', icon: 'drizzle' },
  56: { text: 'Freezing drizzle', icon: 'drizzle' },
  57: { text: 'Dense freezing drizzle', icon: 'drizzle' },
  61: { text: 'Slight rain', icon: 'rain' },
  63: { text: 'Moderate rain', icon: 'rain' },
  65: { text: 'Heavy rain', icon: 'rain' },
  66: { text: 'Freezing rain', icon: 'rain' },
  67: { text: 'Heavy freezing rain', icon: 'rain' },
  71: { text: 'Slight snow', icon: 'snow' },
  73: { text: 'Moderate snow', icon: 'snow' },
  75: { text: 'Heavy snow', icon: 'snow' },
  77: { text: 'Snow grains', icon: 'snow' },
  80: { text: 'Slight rain showers', icon: 'rain' },
  81: { text: 'Moderate rain showers', icon: 'rain' },
  82: { text: 'Violent rain showers', icon: 'rain' },
  85: { text: 'Slight snow showers', icon: 'snow' },
  86: { text: 'Heavy snow showers', icon: 'snow' },
  95: { text: 'Thunderstorm', icon: 'storm' },
  96: { text: 'Thunderstorm, slight hail', icon: 'storm' },
  99: { text: 'Thunderstorm, heavy hail', icon: 'storm' },
};

export function weatherCodeInfo(code) {
  return WMO[code] || { text: 'Conditions unavailable', icon: 'cloud' };
}

export function cToF(c) { return (c * 9) / 5 + 32; }

export function formatTemp(celsius, unit) {
  if (celsius === null || celsius === undefined || Number.isNaN(celsius)) return '—';
  const v = unit === 'F' ? cToF(celsius) : celsius;
  return `${Math.round(v)}°`;
}

export function pad(n) { return String(n).padStart(2, '0'); }

export function formatClock(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDateLabel(date) {
  return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatTimestamp(date) {
  return `${pad(date.getDate())} ${date.toLocaleDateString('en-IN', { month: 'short' })} ${date.getFullYear()}, ${formatClock(date)}`;
}

/** Add N calendar days to a "YYYY-MM-DD" string, returning the same format. */
export function addDaysToDateStr(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * Explicit rule table resolving a time-range key into a day offset (from
 * the location's "today") and an hour range. Calendar-string based so it
 * never drifts across the browser's timezone vs. the queried location's
 * timezone — the parser never invents a window outside this table.
 */
export const TIME_RULES = {
  now: { label: 'Right now', dayOffset: 0, hourStart: null, hourEnd: null, whole: false },
  today: { label: 'Today', dayOffset: 0, hourStart: 0, hourEnd: 24, whole: true },
  today_evening: { label: 'This evening, 17:00–21:00', dayOffset: 0, hourStart: 17, hourEnd: 21, whole: false },
  tomorrow: { label: 'Tomorrow', dayOffset: 1, hourStart: 0, hourEnd: 24, whole: true },
  tomorrow_morning: { label: 'Tomorrow, 06:00–11:00', dayOffset: 1, hourStart: 6, hourEnd: 11, whole: false },
  tomorrow_evening: { label: 'Tomorrow, 17:00–21:00', dayOffset: 1, hourStart: 17, hourEnd: 21, whole: false },
  week: { label: 'Next 7 days', dayOffset: 0, hourStart: 0, hourEnd: 24, whole: true, span: 7 },
};

export function resolveTimeWindow(key) {
  return TIME_RULES[key] || TIME_RULES.today;
}

/** Very small, explicit intent parser — location / time / variable keywords. */
export function parseQuery(text, cities) {
  const lower = text.toLowerCase();
  let time = null;
  if (/tomorrow morning|kal subah|subah/.test(lower)) time = 'tomorrow_morning';
  else if (/tomorrow evening|kal shaam/.test(lower)) time = 'tomorrow_evening';
  else if (/tomorrow|kal/.test(lower)) time = 'tomorrow';
  else if (/this evening|tonight|shaam/.test(lower)) time = 'today_evening';
  else if (/next week|7.day|week ahead/.test(lower)) time = 'week';
  else if (/right now|currently|abhi/.test(lower)) time = 'now';
  else if (/today|aaj/.test(lower)) time = 'today';

  let variable = null;
  if (/rain|baarish|precipitation|showers/.test(lower)) variable = 'rainfall';
  else if (/wind|hawa/.test(lower)) variable = 'wind';
  else if (/warning|alert/.test(lower)) variable = 'warnings';
  else if (/temperature|hot|cold|garmi|thand/.test(lower)) variable = 'temperature';
  else if (/climate|trend|history|historical/.test(lower)) variable = 'climate';

  let location = null;
  for (const c of cities) {
    if (lower.includes(c.name.toLowerCase())) { location = c; break; }
  }

  let intent = 'forecast';
  if (/should i|can i|is it safe|worth/.test(lower)) intent = 'decision';

  return { time, variable, location, intent };
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

export function mean(arr) {
  const v = arr.filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

export function spread(arr) {
  const v = arr.filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
  if (v.length < 2) return 0;
  return Math.max(...v) - Math.min(...v);
}
