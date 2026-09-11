import { Dropdown } from './dropdown.js';
import * as api from './api.js';
import * as U from './utils.js';
import { LANGUAGES, t, applyTranslations } from './i18n.js';
import { initAlertsMap, updateAlertsMap, panToAlert } from './map.js';

// ==========================================================================
// State
// ==========================================================================

const QUICK_CITIES = [
  { name: 'Raipur', admin1: 'Chhattisgarh', country: 'India', latitude: 21.2514, longitude: 81.6296 },
  { name: 'Mumbai', admin1: 'Maharashtra', country: 'India', latitude: 19.0760, longitude: 72.8777 },
  { name: 'Delhi', admin1: 'Delhi', country: 'India', latitude: 28.6139, longitude: 77.2090 },
  { name: 'Pune', admin1: 'Maharashtra', country: 'India', latitude: 18.5204, longitude: 73.8567 },
  { name: 'Nashik', admin1: 'Maharashtra', country: 'India', latitude: 19.9975, longitude: 73.7898 },
  { name: 'Kolkata', admin1: 'West Bengal', country: 'India', latitude: 22.5726, longitude: 88.3639 },
  { name: 'Chennai', admin1: 'Tamil Nadu', country: 'India', latitude: 13.0827, longitude: 80.2707 },
  { name: 'Bengaluru', admin1: 'Karnataka', country: 'India', latitude: 12.9716, longitude: 77.5946 },
  { name: 'Hyderabad', admin1: 'Telangana', country: 'India', latitude: 17.3850, longitude: 78.4867 },
  { name: 'Jaipur', admin1: 'Rajasthan', country: 'India', latitude: 26.9124, longitude: 75.7873 },
];

const TIME_OPTIONS = [
  { value: 'now', label: 'Now' },
  { value: 'today', label: 'Today' },
  { value: 'today_evening', label: 'This evening' },
  { value: 'tomorrow', label: 'Tomorrow' },
  { value: 'tomorrow_morning', label: 'Tomorrow morning' },
  { value: 'tomorrow_evening', label: 'Tomorrow evening' },
  { value: 'week', label: '7-day' },
];

const VARIABLE_OPTIONS = [
  { value: 'rainfall', label: 'Rainfall' },
  { value: 'temperature', label: 'Temperature' },
  { value: 'wind', label: 'Wind' },
  { value: 'warnings', label: 'Warnings' },
];

const ROLE_OPTIONS = [
  { value: 'citizen', label: 'Citizen' },
  { value: 'farmer', label: 'Farmer' },
  { value: 'traveller', label: 'Traveller' },
  { value: 'officer', label: 'Disaster officer' },
];

const UNIT_OPTIONS = [{ value: 'C', label: '°C' }, { value: 'F', label: '°F' }];

const state = {
  lang: 'en',
  unit: 'C',
  role: 'citizen',
  timeKey: 'tomorrow_evening',
  variable: 'rainfall',
  location: QUICK_CITIES[0],
  forecastCache: new Map(), // "lat,lon" -> {data, fetchedAt}
  conversation: [],
  lastQuery: null,
};

const PREFS_KEY = 'wx_prefs';

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      lang: state.lang,
      unit: state.unit,
      location: state.location,
    }));
  } catch (e) {
    // storage unavailable — non-fatal, just skip persistence this session
  }
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return;
    const prefs = JSON.parse(raw);
    if (prefs.lang) state.lang = prefs.lang;
    if (prefs.unit) state.unit = prefs.unit;
    if (prefs.location && prefs.location.latitude && prefs.location.longitude) {
      state.location = prefs.location;
    }
  } catch (e) {
    // malformed JSON or storage unavailable — keep hardcoded defaults
  }
}

const NOTIFY_KEY = 'wx_notify_locations';

function getNotifyLocations() {
  try {
    return JSON.parse(localStorage.getItem(NOTIFY_KEY) || '[]');
  } catch (e) { return []; }
}

function setNotifyLocations(list) {
  try { localStorage.setItem(NOTIFY_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
}

function isLocationOptedIn(loc) {
  return getNotifyLocations().some((l) => l.name === loc.name && l.latitude === loc.latitude && l.longitude === loc.longitude);
}

// ==========================================================================
// Dropdown factory
// ==========================================================================

function ddMarkup({ id, ariaLabel, searchable, icon }) {
  return `
    <div class="dd" id="${id}">
      <button type="button" class="dd__button" data-dd-button aria-haspopup="listbox" aria-expanded="false" aria-label="${ariaLabel}">
        ${icon ? `<svg class="icon icon-sm"><use href="#icon-${icon}"/></svg>` : ''}
        <span data-dd-label></span>
        <svg class="icon-sm dd__button-caret"><use href="#icon-chevron-down"/></svg>
      </button>
      <div class="dd__list" data-dd-list role="listbox" hidden>
        ${searchable ? '<input type="text" class="dd__search" data-dd-search placeholder="Search city, district…" aria-label="Search location">' : ''}
      </div>
    </div>`;
}

// ==========================================================================
// Toast
// ==========================================================================

function toast(msg) {
  const region = document.getElementById('toast-region');
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  region.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function staleBannerHtml(forecast) {
  if (!forecast.isStale) return '';
  return `<div class="stale-banner">
    <svg class="icon-sm"><use href="#icon-info"/></svg>
    <span>Showing last known data from ${escapeHtml(U.formatTimestamp(forecast.fetchedAt))}. Live data unavailable.</span>
  </div>`;
}

// ==========================================================================
// Location search
// ==========================================================================

function cityOptionList(query) {
  if (!query) {
    return QUICK_CITIES.map((c) => ({ value: c, label: c.name, sub: c.admin1 }));
  }
  return null; // triggers live geocode
}

async function wireLocationDropdown(dd, onSelect) {
  const root = dd.root;
  const list = root.querySelector('[data-dd-list]');
  const renderQuick = () => dd.renderOptions(cityOptionList('').map((o) => ({
    value: JSON.stringify(o.value), label: o.label, sub: o.sub,
  })), null);

  dd.opts.onOpen = renderQuick;
  dd.opts.onSelect = (valStr) => onSelect(JSON.parse(valStr));
  dd.opts.onSearch = U.debounce(async (query) => {
    if (!query || query.length < 2) { renderQuick(); return; }
    list.querySelectorAll('.dd__empty').forEach((n) => n.remove());
    try {
      const results = await api.geocode(query);
      if (!results.length) {
        dd.renderOptions([], null);
        return;
      }
      dd.renderOptions(results.map((r) => ({
        value: JSON.stringify(r),
        label: r.name,
        sub: [r.admin1, r.country].filter(Boolean).join(', '),
      })), null);
    } catch (e) {
      list.innerHTML = '<p class="dd__empty">Search unavailable — check your connection.</p>';
    }
  }, 300);
}

// ==========================================================================
// Nav dropdowns
// ==========================================================================

function setLocationAndRefresh(city, { announce = true } = {}) {
  state.location = city;
  const navLabel = document.getElementById('dd-nav-location').querySelector('[data-dd-label]');
  if (navLabel) navLabel.textContent = city.name;
  document.querySelectorAll('.dd--location-inline [data-dd-label]').forEach((el) => { el.textContent = city.name; });
  if (announce) toast(`Location set to ${city.name}${city.admin1 ? ', ' + city.admin1 : ''}.`);
  savePrefs();
  runQuery({});
}

function setupNavDropdowns() {
  const langDd = new Dropdown(document.getElementById('dd-language'), {
    onSelect: (val) => {
      state.lang = val;
      savePrefs();
      langDd.setLabel(LANGUAGES.find((l) => l.value === val).label.split(' ')[0]);
      applyTranslations(document, state.lang);
      renderSuggestions();
      renderStructuredControls();
      if (state.lastQuery) runQuery({ silent: true });
      renderWarningsView();
    },
  });
  langDd.setLabel(LANGUAGES.find((l) => l.value === state.lang)?.label.split(' ')[0] || 'English');
  langDd.renderOptions(LANGUAGES.map((l) => ({ value: l.value, label: l.label })), state.lang);

  const unitDd = new Dropdown(document.getElementById('dd-unit'), {
    onSelect: (val) => {
      state.unit = val;
      savePrefs();
      unitDd.setLabel(UNIT_OPTIONS.find((u) => u.value === val).label);
      if (state.lastQuery) runQuery({ silent: true });
    },
  });
  unitDd.setLabel(UNIT_OPTIONS.find((u) => u.value === state.unit)?.label || '°C');
  unitDd.renderOptions(UNIT_OPTIONS, state.unit);

  const navLocRoot = document.getElementById('dd-nav-location');
  const navLocDd = new Dropdown(navLocRoot, { onSelect: () => {} });
  navLocDd.setLabel(state.location.name);
  wireLocationDropdown(navLocDd, (city) => setLocationAndRefresh(city));
}

function setupGeolocation() {
  const btn = document.getElementById('geolocate-btn');
  if (!navigator.geolocation) {
    btn.disabled = true;
    btn.title = 'Location detection is not supported in this browser';
    return;
  }
  btn.addEventListener('click', () => {
    btn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        btn.disabled = false;
        const { latitude, longitude } = pos.coords;
        const nearest = nearestQuickCity(latitude, longitude);
        // Use the user's real coordinates for the forecast, but a friendly
        // label — nearest known city name if it's reasonably close, else
        // a plain "Current location" label with no invented place name.
        const distKm = haversineKm(latitude, longitude, nearest.latitude, nearest.longitude);
        const city = distKm <= 50
          ? { ...nearest, latitude, longitude }
          : { name: 'Current location', admin1: '', country: '', latitude, longitude };
        setLocationAndRefresh(city);
      },
      () => {
        btn.disabled = false;
        toast("Couldn't get your location — search for a city instead.");
      },
      { timeout: 8000 }
    );
  });
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestQuickCity(lat, lon) {
  return QUICK_CITIES.reduce((best, c) => {
    const d = haversineKm(lat, lon, c.latitude, c.longitude);
    return d < best.dist ? { city: c, dist: d } : best;
  }, { city: QUICK_CITIES[0], dist: Infinity }).city;
}

// ==========================================================================
// Structured controls (Ask page)
// ==========================================================================

let structuredDropdowns = {};

function renderStructuredControls() {
  const wrap = document.getElementById('structured-controls');
  wrap.innerHTML = '';

  // Location
  const locWrap = document.createElement('div');
  locWrap.innerHTML = `<div class="dd__meta" data-i18n="loc_label">Location</div>`;
  locWrap.classList.add('dd--location-inline');
  wrap.appendChild(locWrap);
  locWrap.insertAdjacentHTML('beforeend', ddMarkup({ id: 'dd-ctrl-location', ariaLabel: 'Location', icon: 'pin', searchable: true }));
  const locDd = new Dropdown(locWrap.querySelector('.dd'), { onSelect: () => {} });
  locDd.setLabel(state.location.name);
  wireLocationDropdown(locDd, (city) => {
    state.location = city;
    locDd.setLabel(city.name);
    document.getElementById('dd-nav-location').querySelector('[data-dd-label]').textContent = city.name;
  });

  // Time range
  const timeWrap = document.createElement('div');
  timeWrap.innerHTML = `<div class="dd__meta" data-i18n="time_label">Time range</div>`;
  wrap.appendChild(timeWrap);
  timeWrap.insertAdjacentHTML('beforeend', ddMarkup({ id: 'dd-ctrl-time', ariaLabel: 'Time range', icon: 'clock' }));
  const timeDd = new Dropdown(timeWrap.querySelector('.dd'), {
    onSelect: (val) => { state.timeKey = val; timeDd.setLabel(TIME_OPTIONS.find((o) => o.value === val).label); },
  });
  timeDd.setLabel(TIME_OPTIONS.find((o) => o.value === state.timeKey).label);
  timeDd.renderOptions(TIME_OPTIONS, state.timeKey);

  // Variable
  const varWrap = document.createElement('div');
  varWrap.innerHTML = `<div class="dd__meta" data-i18n="variable_label">Variable</div>`;
  wrap.appendChild(varWrap);
  varWrap.insertAdjacentHTML('beforeend', ddMarkup({ id: 'dd-ctrl-variable', ariaLabel: 'Variable', icon: 'rain-gauge' }));
  const varDd = new Dropdown(varWrap.querySelector('.dd'), {
    onSelect: (val) => { state.variable = val; varDd.setLabel(VARIABLE_OPTIONS.find((o) => o.value === val).label); },
  });
  varDd.setLabel(VARIABLE_OPTIONS.find((o) => o.value === state.variable).label);
  varDd.renderOptions(VARIABLE_OPTIONS, state.variable);

  // Role
  const roleWrap = document.createElement('div');
  roleWrap.innerHTML = `<div class="dd__meta" data-i18n="role_label">Role</div>`;
  wrap.appendChild(roleWrap);
  roleWrap.insertAdjacentHTML('beforeend', ddMarkup({ id: 'dd-ctrl-role', ariaLabel: 'Role', icon: 'compass' }));
  const roleDd = new Dropdown(roleWrap.querySelector('.dd'), {
    onSelect: (val) => { state.role = val; roleDd.setLabel(ROLE_OPTIONS.find((o) => o.value === val).label); },
  });
  roleDd.setLabel(ROLE_OPTIONS.find((o) => o.value === state.role).label);
  roleDd.renderOptions(ROLE_OPTIONS, state.role);

  const goBtn = document.createElement('button');
  goBtn.className = 'btn btn--gold';
  goBtn.style.alignSelf = 'flex-end';
  goBtn.innerHTML = `Get answer <svg class="icon-sm"><use href="#icon-arrow-right"/></svg>`;
  goBtn.addEventListener('click', () => runQuery({}));
  wrap.appendChild(goBtn);

  applyTranslations(wrap, state.lang);
  structuredDropdowns = { locDd, timeDd, varDd, roleDd };
}

// ==========================================================================
// Suggestions
// ==========================================================================

const SUGGESTIONS = [
  { en: 'Will it rain tomorrow?', hi: 'क्या कल बारिश होगी?' },
  { en: 'Is there any warning near me?', hi: 'क्या मेरे पास कोई चेतावनी है?' },
  { en: 'Should I travel this evening?', hi: 'क्या मुझे आज शाम यात्रा करनी चाहिए?' },
  { en: 'How hot will this weekend be?', hi: 'यह सप्ताहांत कितना गर्म होगा?' },
];

function renderSuggestions() {
  const wrap = document.getElementById('suggestions');
  wrap.innerHTML = '';
  SUGGESTIONS.forEach((s) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'suggestion-chip';
    chip.textContent = s[state.lang] || s.en;
    chip.addEventListener('click', () => {
      document.getElementById('chat-input').value = s.en;
      runQuery({ text: s.en });
    });
    wrap.appendChild(chip);
  });
}

// ==========================================================================
// View switching
// ==========================================================================

function switchView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === name));
  document.querySelectorAll('[data-view-link]').forEach((a) => {
    const active = a.dataset.viewLink === name;
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (name === 'warnings') {
    renderWarningsView();
    setupNotifyToggle();
    startWarningsPolling();
    const refreshBtn = document.getElementById('warnings-refresh');
    if (refreshBtn && !refreshBtn.dataset.wired) {
      refreshBtn.dataset.wired = '1';
      refreshBtn.addEventListener('click', () => renderWarningsView());
    }
    const imdList = document.getElementById('imd-alerts-list');
    if (imdList && !imdList.dataset.wired) {
      imdList.dataset.wired = '1';
      imdList.addEventListener('click', (e) => {
        const card = e.target.closest('[data-guid]');
        if (card) panToAlert(card.dataset.guid);
      });
    }
  }
  if (name === 'climate' && !document.getElementById('climate-controls').childElementCount) setupClimateControls();
}

function setupNav() {
  document.querySelectorAll('[data-view-link]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      switchView(a.dataset.viewLink);
    });
  });
  document.querySelectorAll('[data-scroll-to]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      switchView('ask');
      setTimeout(() => document.getElementById(a.dataset.scrollTo).scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    });
  });
}

function setupNotifyToggle() {
  const input = document.getElementById('notify-toggle-input');
  if (!('Notification' in window)) {
    input.disabled = true;
    input.parentElement.title = 'Notifications are not supported in this browser';
    return;
  }
  input.checked = isLocationOptedIn(state.location);
  input.addEventListener('change', async () => {
    if (input.checked) {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        input.checked = false;
        toast('Notification permission was not granted.');
        return;
      }
      const list = getNotifyLocations().filter((l) => l.name !== state.location.name);
      list.push({ name: state.location.name, latitude: state.location.latitude, longitude: state.location.longitude, lastNotifiedLevel: null });
      setNotifyLocations(list);
    } else {
      setNotifyLocations(getNotifyLocations().filter((l) => l.name !== state.location.name));
    }
  });
}

function setupConnectivityBanner() {
  const banner = document.getElementById('connectivity-banner');
  const dismiss = document.getElementById('connectivity-dismiss');
  const update = () => { banner.hidden = navigator.onLine; };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  dismiss.addEventListener('click', () => { banner.hidden = true; });
  update();
}

function setupTabs() {
  const chatTab = document.getElementById('tab-chat');
  const ctrlTab = document.getElementById('tab-controls');
  const chatPanel = document.getElementById('panel-chat');
  const ctrlPanel = document.getElementById('panel-controls');
  const activate = (which) => {
    const chat = which === 'chat';
    chatTab.setAttribute('aria-selected', String(chat));
    ctrlTab.setAttribute('aria-selected', String(!chat));
    chatPanel.hidden = !chat;
    ctrlPanel.hidden = chat;
    if (!chat && !document.getElementById('structured-controls').childElementCount) renderStructuredControls();
  };
  chatTab.addEventListener('click', () => activate('chat'));
  ctrlTab.addEventListener('click', () => activate('controls'));
}

// ==========================================================================
// Query pipeline
// ==========================================================================

async function getForecastCached(loc) {
  const key = `${loc.latitude.toFixed(3)},${loc.longitude.toFixed(3)}`;
  const cached = state.forecastCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < 10 * 60 * 1000) return { data: cached.data, fromCache: true };
  const data = await api.fetchForecast(loc.latitude, loc.longitude);
  state.forecastCache.set(key, { data, fetchedAt: Date.now() });
  return { data, fromCache: false };
}

function selectWindowHours(forecast, timeKey) {
  const rule = U.resolveTimeWindow(timeKey);
  const baseDate = forecast.hourly[0].time.slice(0, 10);
  const targetDate = U.addDaysToDateStr(baseDate, rule.dayOffset);
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

function computeConfidence(hours, field) {
  // field: 'pop' | 'precipitation' | 'temperature'
  const spreads = hours.map((h) => U.spread(h.models[field] || []));
  const avgSpread = U.mean(spreads) || 0;
  let level, label;
  const thresholds = field === 'temperature' ? [1.5, 3.5] : [15, 35];
  if (avgSpread <= thresholds[0]) { level = 'high'; label = 'High'; }
  else if (avgSpread <= thresholds[1]) { level = 'moderate'; label = 'Moderate'; }
  else { level = 'low'; label = 'Low'; }
  return { level, label, avgSpread };
}

function riskLevelFor(hours, daily) {
  const maxPop = Math.max(0, ...hours.map((h) => h.pop ?? 0));
  const maxPrecip = hours.reduce((a, h) => a + (h.precipitation ?? 0), 0);
  const maxWind = Math.max(0, ...hours.map((h) => h.windSpeed ?? 0));
  const maxTemp = Math.max(0, ...hours.map((h) => h.temperature ?? 0));
  if (maxPrecip >= 65 || maxWind >= 62 || maxTemp >= 45) return { level: 'danger', label: 'Orange-level risk', maxPop, maxPrecip, maxWind, maxTemp };
  if (maxPrecip >= 30 || maxPop >= 70 || maxWind >= 40 || maxTemp >= 42) return { level: 'warning', label: 'Yellow-level risk', maxPop, maxPrecip, maxWind, maxTemp };
  return { level: 'success', label: 'No elevated risk', maxPop, maxPrecip, maxWind, maxTemp };
}

const ROLE_ACTION = {
  citizen: {
    high: (v) => `Carry rain protection if you're heading out — ${v}.`,
    moderate: (v) => `Conditions look manageable, but keep an eye on the sky — ${v}.`,
    low: (v) => `No particular precaution needed right now — ${v}.`,
  },
  farmer: {
    high: (v) => `Hold off on spraying or harvesting during this window — ${v}.`,
    moderate: (v) => `Irrigation can likely be paused if this rainfall arrives — ${v}.`,
    low: (v) => `Field work should be unaffected — ${v}.`,
  },
  traveller: {
    high: (v) => `Expect delays on the road during this window — consider shifting your travel time. ${v}`,
    moderate: (v) => `Minor delays are possible; check conditions again closer to departure. ${v}`,
    low: (v) => `Travel conditions look clear for this window. ${v}`,
  },
  officer: {
    high: (v) => `Recommend pre-positioning resources for this district ahead of the window. ${v}`,
    moderate: (v) => `Worth monitoring — conditions sit below warning thresholds but bear watching. ${v}`,
    low: (v) => `No response action indicated at this time. ${v}`,
  },
};

function buildStatement(variable, hours, risk) {
  if (!hours.length) return { headline: 'No forecast data for this window', tier: 'low' };
  const wc = hours[Math.floor(hours.length / 2)].weatherCode;
  const info = U.weatherCodeInfo(wc);
  const maxPop = risk.maxPop;
  let tier = 'low';
  if (variable === 'rainfall') {
    if (maxPop >= 65) tier = 'high';
    else if (maxPop >= 35) tier = 'moderate';
    const headline = maxPop >= 65 ? 'Rain likely' : maxPop >= 35 ? 'Rain possible' : 'Rain unlikely';
    return { headline, tier, subtext: info.text };
  }
  if (variable === 'wind') {
    const w = Math.max(0, ...hours.map((h) => h.windSpeed ?? 0));
    tier = w >= 40 ? 'high' : w >= 25 ? 'moderate' : 'low';
    return { headline: w >= 40 ? 'Strong winds expected' : w >= 25 ? 'Breezy conditions' : 'Winds light', tier, subtext: info.text };
  }
  // temperature default
  const t = U.mean(hours.map((h) => h.temperature));
  tier = t >= 38 ? 'high' : t >= 32 ? 'moderate' : 'low';
  return { headline: info.text, tier, subtext: `Around ${U.formatTemp(t, state.unit)}` };
}

async function runQuery({ text, silent } = {}) {
  const area = document.getElementById('answer-area');
  const confirmRow = document.getElementById('confirm-row');

  let timeKey = state.timeKey;
  let variable = state.variable;
  let location = state.location;

  if (text) {
    const parsed = U.parseQuery(text, QUICK_CITIES);
    if (parsed.time) timeKey = parsed.time;
    if (parsed.variable) variable = parsed.variable;
    if (parsed.location) location = parsed.location;
    // Follow-up context: unresolved fields fall back to the last query.
    state.timeKey = timeKey; state.variable = variable; state.location = location;
    state.conversation.push({ role: 'user', text });
  }

  state.lastQuery = { timeKey, variable, location };

  if (!silent) {
    renderProcessing(area);
  }

  const steps = document.querySelectorAll('#answer-area .processing__step');
  const advance = (i) => { steps.forEach((s, idx) => { s.classList.toggle('is-done', idx < i); s.classList.toggle('is-active', idx === i); }); };
  if (!silent) advance(0);

  let forecastResult;
  try {
    if (!silent) { await sleep(220); advance(1); }
    if (!silent) { await sleep(180); advance(2); }
    forecastResult = await getForecastCached(location);
    if (!silent) { advance(3); await sleep(160); }
    if (!silent) { advance(4); await sleep(140); }
  } catch (err) {
    renderError(area, location, err);
    return;
  }

  renderResult(area, { location, timeKey, variable, forecast: forecastResult.data, fromCache: forecastResult.fromCache });
  renderConfirmRow(confirmRow, { location, timeKey, variable });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function renderProcessing(area) {
  area.innerHTML = `
    <div class="processing">
      <p class="processing__label">Resolving your question</p>
      <div class="processing__step"><span class="processing__mark"></span>Understanding location and time</div>
      <div class="processing__step"><span class="processing__mark"></span>Checking risk indicators</div>
      <div class="processing__step"><span class="processing__mark"></span>Retrieving forecast data</div>
      <div class="processing__step"><span class="processing__mark"></span>Comparing sources</div>
      <div class="processing__step"><span class="processing__mark"></span>Preparing answer</div>
    </div>`;
}

function renderError(area, location, err) {
  area.innerHTML = `
    <div class="state-panel state-panel--error">
      <p class="state-panel__title">Live weather data is temporarily unavailable</p>
      <p class="state-panel__body">We couldn't reach the forecast source for ${escapeHtml(location.name)} just now (${escapeHtml(err.message || 'network error')}). Nothing below is invented — please retry.</p>
      <button class="btn btn--secondary btn--sm" id="retry-btn"><svg class="icon-sm"><use href="#icon-refresh"/></svg> Retry</button>
    </div>`;
  document.getElementById('retry-btn').addEventListener('click', () => runQuery({}));
}

function renderConfirmRow(row, { location, timeKey, variable }) {
  const timeLabel = TIME_OPTIONS.find((o) => o.value === timeKey)?.label || timeKey;
  const varLabel = VARIABLE_OPTIONS.find((o) => o.value === variable)?.label || variable;
  row.hidden = false;
  row.innerHTML = `
    <span class="confirm-row__item"><svg class="icon-sm"><use href="#icon-pin"/></svg><strong>${escapeHtml(location.name)}${location.admin1 ? ', ' + escapeHtml(location.admin1) : ''}</strong></span>
    <span class="confirm-row__item"><svg class="icon-sm"><use href="#icon-clock"/></svg><strong>${escapeHtml(timeLabel)}</strong></span>
    <span class="confirm-row__item"><svg class="icon-sm"><use href="#icon-rain-gauge"/></svg><strong>${escapeHtml(varLabel)}</strong></span>
    <button class="confirm-row__edit" id="confirm-edit">Edit</button>`;
  document.getElementById('confirm-edit').addEventListener('click', () => {
    document.getElementById('tab-controls').click();
    document.getElementById('station').scrollIntoView({ behavior: 'smooth' });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --------------------------------------------------------------------------
// Result rendering
// --------------------------------------------------------------------------

function renderResult(area, { location, timeKey, variable, forecast, fromCache }) {
  const { hours: hourlyHours, rule } = selectWindowHours(forecast, timeKey);
  const daily = forecast.daily;
  // For a 7-day window, aggregate across the daily series (model-averaged)
  // rather than a single day of hourly data — still real retrieved values.
  const hours = timeKey === 'week'
    ? daily.slice(0, 7).map((d) => ({
        time: d.time, pop: d.pop, precipitation: d.precipSum, windSpeed: d.windMax, temperature: d.tempMax,
        weatherCode: d.weatherCode, models: { pop: d.models.pop, precipitation: d.models.precipSum, temperature: d.models.tempMax },
      }))
    : hourlyHours;
  const risk = riskLevelFor(hours.length ? hours : (daily[0] ? [{ pop: daily[0].pop, precipitation: daily[0].precipSum, windSpeed: daily[0].windMax, temperature: daily[0].tempMax }] : []), daily);
  const statement = buildStatement(variable === 'warnings' ? 'rainfall' : variable, hours.length ? hours : [], risk);
  const confidence = hours.length ? computeConfidence(hours, variable === 'temperature' ? 'temperature' : 'pop') : { level: 'low', label: 'Low', avgSpread: 0 };

  const roleFn = ROLE_ACTION[state.role][statement.tier];
  const actionText = roleFn(statement.subtext || '');

  const source = forecast.modelIds.map((m) => modelDisplayName(m)).join(', ');
  const updated = U.formatTimestamp(forecast.fetchedAt);
  const staleHtml = staleBannerHtml(forecast);

  const warningBannerHtml = renderWarningBanner(risk, location, rule);

  const evidenceHtml = renderEvidence({ hours, risk, confidence, rule, source, updated, forecast, variable });

  area.innerHTML = `
    ${staleHtml}
    ${warningBannerHtml}
    <div class="result">
      <p class="result__location"><svg class="icon-sm"><use href="#icon-pin"/></svg> ${escapeHtml(location.name)}${location.admin1 ? ', ' + escapeHtml(location.admin1) : ''} · ${escapeHtml(rule.label)}${fromCache ? ' · <span style="color:var(--status-warning)">cached</span>' : ''}</p>
      <h2 class="result__statement">${escapeHtml(statement.headline)}${statement.subtext && variable !== 'temperature' ? ', ' + escapeHtml(rule.label.toLowerCase()) : ''}</h2>
      <p class="result__action"><strong>Suggested for ${roleDisplay(state.role)}:</strong> ${escapeHtml(actionText)}</p>

      <div class="metric-row">
        ${metric('Rain probability', hours.length ? `${Math.round(risk.maxPop)}%` : '—')}
        ${metric('Rainfall', hours.length ? `${risk.maxPrecip.toFixed(1)} mm` : '—')}
        ${metric('Wind', hours.length ? `${Math.round(risk.maxWind)} km/h` : '—')}
        ${metric('Temperature', hours.length ? U.formatTemp(U.mean(hours.map((h) => h.temperature)), state.unit) : '—')}
      </div>

      <div class="confidence-row">
        <span class="confidence-label">Confidence: <strong>${confidence.label}</strong>${confidence.level !== 'high' ? ' — sources disagree' : ''}</span>
        <div class="confidence-bar"><div class="confidence-bar__fill${confidence.level === 'moderate' ? ' confidence-bar__fill--moderate' : confidence.level === 'low' ? ' confidence-bar__fill--low' : ''}" style="width:${confidence.level === 'high' ? 90 : confidence.level === 'moderate' ? 58 : 30}%"></div></div>
      </div>

      <div class="source-stamp font-mono">
        <span>Source: ${escapeHtml(source)}</span>
        <span>Updated: ${escapeHtml(updated)} ${escapeHtml(forecast.timezone || '')}</span>
      </div>

      <button class="why-toggle" id="why-toggle" aria-expanded="false" aria-controls="evidence-panel">
        Why? <svg class="icon-sm"><use href="#icon-plus"/></svg>
      </button>
      <div class="evidence" id="evidence-panel" hidden>${evidenceHtml}</div>
    </div>

    ${renderHourlyStrip(forecast.hourly, rule)}
    ${renderDailyTable(forecast.daily)}
  `;

  const whyBtn = document.getElementById('why-toggle');
  const panel = document.getElementById('evidence-panel');
  whyBtn.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    whyBtn.setAttribute('aria-expanded', String(open));
  });

  state.conversation.push({ role: 'assistant', text: statement.headline, location, timeKey, variable });
}

function modelDisplayName(id) {
  return { ecmwf_ifs025: 'ECMWF IFS', gfs_seamless: 'NOAA GFS', icon_seamless: 'DWD ICON' }[id] || id;
}

function roleDisplay(role) {
  return ROLE_OPTIONS.find((r) => r.value === role)?.label || role;
}

function metric(label, value) {
  return `<div class="metric"><div class="metric__label">${escapeHtml(label)}</div><div class="metric__value">${escapeHtml(value)}</div></div>`;
}

function renderWarningBanner(risk, location, rule) {
  if (risk.level === 'success') {
    return `<div class="warning-banner warning-banner--success">
      <svg class="warning-banner__icon"><use href="#icon-check-circle"/></svg>
      <div>
        <p class="warning-banner__level">No active risk</p>
        <p class="warning-banner__title">No active warnings for ${escapeHtml(location.name)}</p>
        <p class="warning-banner__body">This section updates automatically each time you ask — based on live forecast thresholds, not an official IMD feed.</p>
      </div>
    </div>`;
  }
  const isDanger = risk.level === 'danger';
  return `<div class="warning-banner warning-banner--${risk.level}">
    <svg class="warning-banner__icon"><use href="#icon-warning"/></svg>
    <div>
      <p class="warning-banner__level">${isDanger ? 'Orange-level risk' : 'Yellow-level risk'} · derived indicator</p>
      <p class="warning-banner__title">${isDanger ? 'Heavy conditions likely' : 'Elevated conditions possible'}</p>
      <p class="warning-banner__body">Rain probability up to ${Math.round(risk.maxPop)}%, wind up to ${Math.round(risk.maxWind)} km/h during ${escapeHtml(rule.label.toLowerCase())}. This is a threshold-derived indicator, not an official IMD warning — see the Warnings page for details.</p>
    </div>
  </div>`;
}

function renderEvidence({ hours, risk, confidence, rule, source, updated, forecast, variable }) {
  const items = [
    ['rain-gauge', 'Rainfall (window total)', `${risk.maxPrecip.toFixed(1)} mm`],
    ['gauge', 'Rain probability (peak)', `${Math.round(risk.maxPop)}%`],
    ['wind-rose', 'Wind (peak)', `${Math.round(risk.maxWind)} km/h`],
    ['warning', 'Risk level', risk.level === 'success' ? 'None' : risk.level === 'danger' ? 'Orange' : 'Yellow'],
    ['pin', 'Location', `${forecast.timezone}`],
    ['clock', 'Valid', rule.label],
  ];
  const itemsHtml = items.map(([icon, label, value]) => `
    <div class="evidence__item">
      <svg class="icon"><use href="#icon-${icon}"/></svg>
      <div><div class="evidence__item-label">${escapeHtml(label)}</div><div class="evidence__item-value font-mono">${escapeHtml(value)}</div></div>
    </div>`).join('');

  let disagreementHtml = '';
  if (hours.length) {
    const field = variable === 'temperature' ? 'temperature' : 'pop';
    const rows = hours.slice(0, 7).map((h) => `
      <tr>
        <td class="font-mono">${h.time.length > 10 ? h.time.slice(11, 16) : h.time.slice(5)}</td>
        ${forecast.modelIds.map((m, i) => `<td>${fmtModelVal(h.models[field] ? h.models[field][i] : null, field)}</td>`).join('')}
      </tr>`).join('');
    disagreementHtml = `
      <div class="evidence__disagreement">
        <p class="evidence__title">Model comparison — ${field === 'temperature' ? 'temperature (°C)' : 'rain probability (%)'}</p>
        <div class="model-compare-wrap">
          <table class="model-compare">
            <thead><tr><th>Time</th>${forecast.modelIds.map((m) => `<th>${modelDisplayName(m)}</th>`).join('')}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <p style="font-size:12.5px;color:var(--color-taupe);margin-top:var(--sp-3)">
          ${confidence.level === 'high' ? 'Sources are in close agreement for this window.' : `Sources differ by roughly ${Math.round(confidence.avgSpread)}${field === 'temperature' ? '°C' : ' percentage points'} on average — confidence has been reduced accordingly.`}
        </p>
      </div>`;
  }

  return `<p class="evidence__title">Because</p><div class="evidence__grid">${itemsHtml}</div>${disagreementHtml}
    <div class="source-stamp font-mono" style="margin-top:var(--sp-5);padding-top:var(--sp-4);border-top:1px solid var(--border-subtle)">
      <span>Source: ${escapeHtml(source)}</span><span>Updated: ${escapeHtml(updated)}</span>
    </div>`;
}

function fmtModelVal(v, field) {
  if (v === null || v === undefined) return '—';
  return field === 'temperature' ? `${v.toFixed(1)}` : `${Math.round(v)}`;
}

function renderHourlyStrip(hourly, rule) {
  const baseDate = hourly[0].time.slice(0, 10);
  const target = U.addDaysToDateStr(baseDate, rule.dayOffset ?? 0);
  const items = hourly.filter((h) => h.time.slice(0, 10) === target).slice(0, 24);
  if (!items.length) return '';
  return `
    <div class="page-section--tight">
      <div class="section-head"><h3 class="section-head__title" style="font-size:20px">Hourly</h3></div>
      <div class="hourly-strip">
        ${items.map((h) => `
          <div class="hourly-item">
            <div class="hourly-item__time">${h.time.slice(11, 16)}</div>
            <svg class="hourly-item__icon"><use href="#icon-${U.weatherCodeInfo(h.weatherCode).icon}"/></svg>
            <div class="hourly-item__temp">${U.formatTemp(h.temperature, state.unit)}</div>
            <div class="hourly-item__pop">${Math.round(h.pop ?? 0)}%</div>
          </div>`).join('')}
      </div>
    </div>`;
}

function renderDailyTable(daily) {
  return `
    <div class="page-section--tight">
      <div class="section-head"><h3 class="section-head__title" style="font-size:20px">7-day outlook</h3></div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead><tr><th>Day</th><th>Condition</th><th>High</th><th>Low</th><th>Rain</th><th>Wind</th></tr></thead>
          <tbody>
            ${daily.slice(0, 7).map((d) => `
              <tr>
                <td>${new Date(d.time + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                <td>${escapeHtml(U.weatherCodeInfo(d.weatherCode).text)}</td>
                <td>${U.formatTemp(d.tempMax, state.unit)}</td>
                <td>${U.formatTemp(d.tempMin, state.unit)}</td>
                <td>${Math.round(d.pop ?? 0)}%</td>
                <td>${Math.round(d.windMax ?? 0)} km/h</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ==========================================================================
// Warnings view — IMD CAP alerts + derived risk indicators
// ==========================================================================

const WARNINGS_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
let imdPollTimerId = null;
let imdAbortController = null;
let imdPollingActive = false;
let imdLastFetchedAt = null;

/** Map IMD CAP severity to a CSS-compatible tier string */
function imdSeverityTier(sev) {
  switch (sev) {
    case 'Extreme': return 'extreme';
    case 'Severe': return 'severe';
    case 'Moderate': return 'moderate';
    case 'Minor': return 'minor';
    default: return 'unknown';
  }
}

/** Format an ISO timestamp for display, returning a short human-readable string */
function fmtAlertTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' '
         + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return iso; }
}

// --- Client-side IMD CAP XML helpers (fallback when Node server isn't running) ---

const IMD_RSS_URL = 'https://cap-sources.s3.amazonaws.com/in-imd-en/rss.xml';

/** Extract a single XML tag value by name, handling optional namespaces */
function capExtractTag(xml, tag) {
  if (!xml) return '';
  const re = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return '';
  let v = m[1].trim();
  if (v.startsWith('<![CDATA[') && v.endsWith(']]>')) v = v.slice(9, -3).trim();
  return v;
}

/** Extract all matching XML blocks */
function capExtractBlocks(xml, tag) {
  if (!xml) return [];
  const re = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tag}>`, 'gi');
  const blocks = [];
  let m;
  while ((m = re.exec(xml)) !== null) blocks.push(m[1].trim());
  return blocks;
}

/** Clean whitespace artifacts from CAP text fields */
function capClean(t) { return (t || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim(); }

/** Parse a single CAP 1.2 XML document into a normalised alert object */
function capParseDoc(xml, rssMeta = {}) {
  const identifier = capExtractTag(xml, 'identifier') || rssMeta.guid || '';
  const sender = capExtractTag(xml, 'sender') || '';
  const sent = capExtractTag(xml, 'sent') || rssMeta.pubDate || '';
  const status = capExtractTag(xml, 'status') || 'Actual';
  const msgType = capExtractTag(xml, 'msgType') || 'Alert';
  const scope = capExtractTag(xml, 'scope') || 'Public';
  const infoBlocks = capExtractBlocks(xml, 'info');
  const info = infoBlocks[0] || xml;
  const event = capExtractTag(info, 'event') || rssMeta.title || 'Severe Weather Warning';
  const urgency = capExtractTag(info, 'urgency') || 'Unknown';
  const severity = capExtractTag(info, 'severity') || 'Unknown';
  const certainty = capExtractTag(info, 'certainty') || 'Unknown';
  const onset = capExtractTag(info, 'onset') || sent;
  const expires = capExtractTag(info, 'expires') || '';
  const senderName = capExtractTag(info, 'senderName') || 'IMD';
  const headline = capExtractTag(info, 'headline') || rssMeta.title || event;
  const description = capExtractTag(info, 'description') || rssMeta.description || '';
  const instruction = capExtractTag(info, 'instruction') || '';
  const areaBlock = capExtractTag(info, 'area') || info;
  const areaDesc = capExtractTag(areaBlock, 'areaDesc') || 'India';

  const expiresDate = expires ? new Date(expires) : null;
  const isExpired = expiresDate && expiresDate.getTime() < Date.now();

  return {
    guid: identifier || rssMeta.guid,
    identifier, sender, senderName, sent, status, msgType, scope,
    event, urgency, severity, certainty, onset, expires,
    headline: capClean(headline), description: capClean(description),
    instruction: capClean(instruction), areaDesc: capClean(areaDesc),
    link: rssMeta.link || '', isExpired,
    source: 'India Meteorological Department (IMD)',
  };
}

/** Fetch IMD alerts: try the Node server API first, fall back to direct RSS parsing */
async function fetchImdAlerts({ signal } = {}) {
  // Attempt 1: Node.js server API (fast, pre-parsed, cached)
  try {
    const res = await fetch('/api/weather-alerts', { signal });
    if (res.ok) return await res.json();
  } catch (_) { /* server not running — fall through to client-side parsing */ }

  // Attempt 2: Fetch RSS + each CAP XML directly in the browser
  const res = await fetch(IMD_RSS_URL, { signal });
  if (!res.ok) throw new Error(`RSS fetch ${res.status}`);

  const rssXml = await res.text();
  const itemBlocks = capExtractBlocks(rssXml, 'item');
  const alerts = [];

  for (const block of itemBlocks) {
    const title = capExtractTag(block, 'title');
    let link = (capExtractTag(block, 'link') || '').replace(/<\/?[^>]+(>|$)/g, '').trim();
    const guid = capExtractTag(block, 'guid') || link;
    const pubDate = capExtractTag(block, 'pubDate');
    const description = capExtractTag(block, 'description');
    if (!link) continue;

    try {
      const capRes = await fetch(link, { signal });
      if (!capRes.ok) continue;
      const capXml = await capRes.text();
      const alert = capParseDoc(capXml, { guid, link, title, pubDate, description });
      if (alert.msgType === 'Cancel') continue;
      if (alert.isExpired) {
        const expMs = new Date(alert.expires).getTime();
        if (expMs < Date.now() - 24 * 60 * 60 * 1000) continue;
      }
      alerts.push(alert);
    } catch (_) { /* skip individual CAP fetch failures */ }
  }

  // Sort: severity (Extreme > Severe > Moderate > Minor) then recency
  const W = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };
  alerts.sort((a, b) => {
    const d = (W[b.severity] || 0) - (W[a.severity] || 0);
    if (d !== 0) return d;
    return new Date(b.sent || 0).getTime() - new Date(a.sent || 0).getTime();
  });

  return { status: 'success', source: 'India Meteorological Department (IMD)', count: alerts.length, alerts };
}

/** Render a single IMD CAP alert card */
function renderImdAlertCard(alert) {
  const tier = imdSeverityTier(alert.severity);
  const timeWindow = alert.expires
    ? `${fmtAlertTime(alert.onset || alert.sent)} — ${fmtAlertTime(alert.expires)}`
    : fmtAlertTime(alert.sent);
  const expiredTag = alert.isExpired ? '<span class="imd-alert__expired">Expired</span>' : '';

  return `
    <div class="imd-alert imd-alert--${tier}${alert.isExpired ? ' imd-alert--expired' : ''}" data-guid="${escapeHtml(alert.guid || '')}">
      <div class="imd-alert__badge imd-alert__badge--${tier}">
        <span class="imd-alert__badge-text">${escapeHtml(alert.severity || 'Unknown')}</span>
      </div>
      <div class="imd-alert__body">
        <h3 class="imd-alert__headline">${escapeHtml(alert.headline || alert.event || 'Severe Weather Warning')} ${expiredTag}</h3>
        <div class="imd-alert__meta">
          <span class="imd-alert__meta-item">
            <svg class="icon-sm"><use href="#icon-warning"/></svg>
            ${escapeHtml(alert.event || '')}
          </span>
          <span class="imd-alert__meta-item">
            <svg class="icon-sm"><use href="#icon-pin"/></svg>
            ${escapeHtml(alert.areaDesc || 'India')}
          </span>
          <span class="imd-alert__meta-item">
            <svg class="icon-sm"><use href="#icon-clock"/></svg>
            ${escapeHtml(timeWindow)}
          </span>
        </div>
        ${alert.description ? `<p class="imd-alert__desc">${escapeHtml(alert.description)}</p>` : ''}
        ${alert.instruction ? `<p class="imd-alert__instruction"><strong>Safety advisory:</strong> ${escapeHtml(alert.instruction)}</p>` : ''}
        <div class="imd-alert__footer">
          <span class="imd-alert__sender">${escapeHtml(alert.senderName || 'IMD')}</span>
          <span class="imd-alert__certainty">Certainty: ${escapeHtml(alert.certainty || 'Unknown')} · Urgency: ${escapeHtml(alert.urgency || 'Unknown')}</span>
          ${alert.link ? `<a href="${escapeHtml(alert.link)}" target="_blank" rel="noopener" class="imd-alert__link">View full CAP alert →</a>` : ''}
        </div>
      </div>
    </div>`;
}

async function renderWarningsView() {
  const imdList = document.getElementById('imd-alerts-list');
  const derivedList = document.getElementById('warnings-list');

  // ---- Section 1: IMD CAP Alerts ----
  imdList.innerHTML = `<p style="color:var(--color-taupe);font-size:13.5px">Fetching IMD severe weather alerts…</p>`;

  try {
    const payload = await fetchImdAlerts();
    const alerts = payload.alerts || [];

    if (!alerts.length) {
      imdList.innerHTML = `<div class="state-panel state-panel--empty">
        <p class="state-panel__title">No active IMD warnings</p>
        <p class="state-panel__body">The India Meteorological Department currently has no active or recent severe weather alerts in the feed. This view auto-refreshes every few minutes.</p>
      </div>`;
    } else {
      imdList.innerHTML = alerts.map(renderImdAlertCard).join('');
    }

    initAlertsMap();
    updateAlertsMap(alerts);
  } catch (e) {
    imdList.innerHTML = `<div class="state-panel state-panel--error">
      <p class="state-panel__title">IMD alerts unavailable</p>
      <p class="state-panel__body">Could not reach the IMD alerts endpoint (${escapeHtml(e.message || 'network error')}). The derived risk indicators below still work from forecast data.</p>
    </div>`;
  }

  // ---- Section 2: Derived risk indicators (existing logic) ----
  derivedList.innerHTML = `<p style="color:var(--color-taupe);font-size:13.5px">Checking risk indicators for tracked locations…</p>`;
  const targets = [state.location, ...QUICK_CITIES.filter((c) => c.name !== state.location.name)].slice(0, 6);
  try {
    const results = await Promise.all(targets.map(async (loc) => {
      const { data } = await getForecastCached(loc);
      const { hours } = selectWindowHours(data, 'today');
      const risk = riskLevelFor(hours, data.daily);
      return { loc, risk, data };
    }));
    const staleEntry = results.find((r) => r.data && r.data.isStale);
    const staleHeaderHtml = staleEntry ? staleBannerHtml(staleEntry.data) : '';

    const active = results.filter((r) => r.risk.level !== 'success');
    if (!active.length) {
      derivedList.innerHTML = `${staleHeaderHtml}<div class="state-panel state-panel--empty">
        <p class="state-panel__title">No elevated risk detected</p>
        <p class="state-panel__body">None of the tracked locations currently cross the rainfall, wind, or heat thresholds used for this derived indicator.</p>
      </div>`;
      return;
    }
    derivedList.innerHTML = staleHeaderHtml + active.map(({ loc, risk }) => `
      <div class="warning-item">
        <div class="warning-item__badge warning-item__badge--${risk.level}"></div>
        <div class="warning-item__content">
          <div class="warning-item__top">
            <div>
              <div class="warning-item__title">${risk.level === 'danger' ? 'Orange-level risk' : 'Yellow-level risk'}</div>
              <div class="warning-item__region">${escapeHtml(loc.name)}${loc.admin1 ? ', ' + escapeHtml(loc.admin1) : ''}</div>
            </div>
          </div>
          <p class="warning-item__body">Peak rain probability ${Math.round(risk.maxPop)}%, wind up to ${Math.round(risk.maxWind)} km/h today.</p>
          <div class="warning-item__meta">
            <span>Source: Open-Meteo model ensemble</span>
            <span>Issued: ${U.formatTimestamp(new Date())}</span>
            <span>Valid: Today</span>
          </div>
        </div>
      </div>`).join('');
  } catch (e) {
    derivedList.innerHTML = `<div class="state-panel state-panel--error">
      <p class="state-panel__title">Could not check risk indicators</p>
      <p class="state-panel__body">${escapeHtml(e.message || 'Network error')}. Try refreshing.</p>
    </div>`;
  }
  checkNotifyThresholds();
}

// --- IMD alerts auto-polling (5-minute interval) ---

function pollWarningsImd() {
  const imdList = document.getElementById('imd-alerts-list');
  if (!imdList) return;

  if (imdAbortController) imdAbortController.abort();
  imdAbortController = new AbortController();
  const { signal } = imdAbortController;

  fetchImdAlerts({ signal }).then((payload) => {
    if (signal.aborted) return;
    const alerts = payload.alerts || [];
    imdLastFetchedAt = new Date();

    if (!alerts.length) {
      imdList.innerHTML = `<div class="state-panel state-panel--empty">
        <p class="state-panel__title">No active IMD warnings</p>
        <p class="state-panel__body">The India Meteorological Department currently has no active or recent severe weather alerts in the feed.</p>
      </div>`;
    } else {
      imdList.innerHTML = alerts.map(renderImdAlertCard).join('');
    }

    updateAlertsMap(alerts);

    const ts = document.getElementById('imd-last-updated');
    if (ts) ts.textContent = `Last updated: ${imdLastFetchedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  }).catch((e) => {
    if (signal.aborted) return;
    console.warn('[imd-poll] fetch failed, will retry next cycle:', e.message || e);
  });
}

function startWarningsPolling() {
  if (imdPollingActive) return;
  imdPollingActive = true;
  pollWarningsImd();
  imdPollTimerId = setInterval(pollWarningsImd, WARNINGS_REFRESH_INTERVAL_MS);
}

async function checkNotifyThresholds() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const list = getNotifyLocations();
  if (!list.length) return;
  let changed = false;
  for (const entry of list) {
    try {
      const { data } = await getForecastCached(entry);
      const { hours } = selectWindowHours(data, 'today');
      const risk = riskLevelFor(hours, data.daily);
      if (risk.level !== 'success' && risk.level !== entry.lastNotifiedLevel) {
        new Notification(`${risk.level === 'danger' ? 'Orange' : 'Yellow'}-level risk — ${entry.name}`, {
          body: `Derived risk indicator, not an official IMD alert. Peak rain probability ${Math.round(risk.maxPop)}%, wind up to ${Math.round(risk.maxWind)} km/h today. Open WeatherGPT for details.`,
        });
        entry.lastNotifiedLevel = risk.level;
        changed = true;
      } else if (risk.level === 'success' && entry.lastNotifiedLevel !== null) {
        entry.lastNotifiedLevel = null; // risk cleared — allow a fresh notification next time it rises again
        changed = true;
      }
    } catch (e) {
      // skip this location this round on a fetch failure — don't notify from stale/failed data
    }
  }
  if (changed) setNotifyLocations(list);
}

// ==========================================================================
// Climate view
// ==========================================================================

const CLIMATE_METRICS = [
  { value: 'temperature', label: 'Average temperature' },
  { value: 'rainfall', label: 'Rainfall' },
];
const CLIMATE_PERIODS = [
  { value: 5, label: '5 years' },
  { value: 10, label: '10 years' },
  { value: 20, label: '20 years' },
];

const climateState = { metric: 'temperature', years: 10, location: state.location };

function setupClimateControls() {
  const wrap = document.getElementById('climate-controls');
  wrap.innerHTML = '';

  const locWrap = document.createElement('div');
  locWrap.innerHTML = `<div class="dd__meta">Location</div>`;
  wrap.appendChild(locWrap);
  locWrap.insertAdjacentHTML('beforeend', ddMarkup({ id: 'dd-climate-location', ariaLabel: 'Location', icon: 'pin', searchable: true }));
  const locDd = new Dropdown(locWrap.querySelector('.dd'), { onSelect: () => {} });
  locDd.setLabel(climateState.location.name);
  wireLocationDropdown(locDd, (city) => { climateState.location = city; locDd.setLabel(city.name); loadClimate(); });

  const metricWrap = document.createElement('div');
  metricWrap.innerHTML = `<div class="dd__meta">Metric</div>`;
  wrap.appendChild(metricWrap);
  metricWrap.insertAdjacentHTML('beforeend', ddMarkup({ id: 'dd-climate-metric', ariaLabel: 'Metric', icon: 'gauge' }));
  const metricDd = new Dropdown(metricWrap.querySelector('.dd'), {
    onSelect: (v) => { climateState.metric = v; metricDd.setLabel(CLIMATE_METRICS.find((m) => m.value === v).label); loadClimate(); },
  });
  metricDd.setLabel(CLIMATE_METRICS.find((m) => m.value === climateState.metric).label);
  metricDd.renderOptions(CLIMATE_METRICS, climateState.metric);

  const periodWrap = document.createElement('div');
  periodWrap.innerHTML = `<div class="dd__meta">Period</div>`;
  wrap.appendChild(periodWrap);
  periodWrap.insertAdjacentHTML('beforeend', ddMarkup({ id: 'dd-climate-period', ariaLabel: 'Period', icon: 'clock' }));
  const periodDd = new Dropdown(periodWrap.querySelector('.dd'), {
    onSelect: (v) => { climateState.years = Number(v); periodDd.setLabel(CLIMATE_PERIODS.find((p) => p.value === Number(v)).label); loadClimate(); },
  });
  periodDd.setLabel(CLIMATE_PERIODS.find((p) => p.value === climateState.years).label);
  periodDd.renderOptions(CLIMATE_PERIODS.map((p) => ({ value: String(p.value), label: p.label })), String(climateState.years));

  loadClimate();
}

async function loadClimate() {
  const body = document.getElementById('climate-body');
  body.innerHTML = `<p style="color:var(--color-taupe);font-size:13.5px">Retrieving historical archive…</p>`;
  const today = new Date();
  const endYear = today.getFullYear() - 1; // archive has a short lag
  const years = [];
  for (let i = climateState.years - 1; i >= 0; i--) years.push(endYear - i);

  try {
    const perYear = await Promise.all(years.map(async (y) => {
      const start = `${y}-06-01`;
      const end = `${y}-08-31`; // summer window, consistent basis for comparison
      const rows = await api.fetchArchive(climateState.location.latitude, climateState.location.longitude, start, end);
      const avgTemp = U.mean(rows.map((r) => r.tempMean));
      const totalRain = rows.reduce((a, r) => a + (r.precip || 0), 0);
      return { year: y, avgTemp, totalRain };
    }));

    const firstHalf = perYear.slice(0, Math.floor(perYear.length / 2));
    const secondHalf = perYear.slice(Math.floor(perYear.length / 2));
    const metricKey = climateState.metric === 'temperature' ? 'avgTemp' : 'totalRain';
    const baseline = U.mean(firstHalf.map((y) => y[metricKey]));
    const recent = U.mean(secondHalf.map((y) => y[metricKey]));
    const delta = recent - baseline;
    const unitLabel = climateState.metric === 'temperature' ? '°C' : 'mm';
    const direction = Math.abs(delta) < (climateState.metric === 'temperature' ? 0.15 : 15) ? 'held roughly steady' : delta > 0 ? 'increased' : 'decreased';

    const points = perYear.map((y) => ({ x: y.year, y: y[metricKey] }));

    body.innerHTML = `
      <p class="climate-summary">Summer ${climateState.metric === 'temperature' ? 'average temperature' : 'rainfall'} in ${escapeHtml(climateState.location.name)} has ${direction} over the last ${climateState.years} years.</p>
      <p class="climate-sub">Comparing ${firstHalf[0]?.year}–${firstHalf[firstHalf.length - 1]?.year} against ${secondHalf[0]?.year}–${secondHalf[secondHalf.length - 1]?.year} (June–August each year): baseline ${fmtClimate(baseline, unitLabel)}, recent period ${fmtClimate(recent, unitLabel)}, a change of ${delta >= 0 ? '+' : ''}${fmtClimate(delta, unitLabel)}.</p>
      <div class="chart-wrap">${renderLineChart(points, unitLabel)}</div>
      <p class="source-stamp font-mono" style="margin-top:var(--sp-4)">
        <span>Source: Open-Meteo Historical Archive (ERA5 reanalysis)</span>
        <span>Range: ${years[0]}–${years[years.length - 1]}, June–Aug</span>
      </p>`;
  } catch (e) {
    body.innerHTML = `<div class="state-panel state-panel--error">
      <p class="state-panel__title">Historical data unavailable</p>
      <p class="state-panel__body">${escapeHtml(e.message || 'Network error')}. Try again in a moment.</p>
    </div>`;
  }
}

function fmtClimate(v, unit) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${v.toFixed(1)}${unit}`;
}

function renderLineChart(points, unitLabel) {
  const valid = points.filter((p) => p.y !== null && p.y !== undefined);
  if (!valid.length) return '<p style="color:var(--color-taupe);font-size:13px">No data available for this range.</p>';
  const w = 720, h = 260, padL = 46, padR = 20, padT = 20, padB = 34;
  const xs = valid.map((p) => p.x);
  const ys = valid.map((p) => p.y);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const yPad = (maxY - minY) * 0.15 || 1;
  const y0 = minY - yPad, y1 = maxY + yPad;
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const sx = (x) => padL + ((x - x0) / Math.max(1, (x1 - x0))) * (w - padL - padR);
  const sy = (y) => h - padB - ((y - y0) / (y1 - y0)) * (h - padT - padB);

  const path = valid.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ');
  const gridLines = [0, 0.5, 1].map((f) => {
    const yy = y0 + f * (y1 - y0);
    return `<line x1="${padL}" x2="${w - padR}" y1="${sy(yy)}" y2="${sy(yy)}" stroke="var(--border-subtle)" stroke-width="1"/>
      <text x="${padL - 8}" y="${sy(yy) + 4}" text-anchor="end" font-size="10.5" fill="var(--color-taupe)" font-family="var(--font-mono)">${yy.toFixed(1)}</text>`;
  }).join('');
  const xLabels = valid.filter((_, i) => i % Math.ceil(valid.length / 8) === 0).map((p) => `
    <text x="${sx(p.x)}" y="${h - padB + 18}" text-anchor="middle" font-size="10.5" fill="var(--color-taupe)" font-family="var(--font-mono)">${p.x}</text>`).join('');
  const dots = valid.map((p) => `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="2.6" fill="var(--color-gold-text)"/>`).join('');

  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Trend chart" style="width:100%;height:auto">
    ${gridLines}
    <path d="${path}" fill="none" stroke="var(--color-gold-text)" stroke-width="2"/>
    ${dots}
    ${xLabels}
  </svg>`;
}

// ==========================================================================
// Boot
// ==========================================================================

function setupChatForm() {
  const form = document.getElementById('chat-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    runQuery({ text });
  });

  const mic = document.getElementById('mic-btn');
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    mic.disabled = true;
    // Safari (desktop + iOS) ships neither SpeechRecognition nor webkitSpeechRecognition,
    // but does ship webkitAudioContext — a reasonably reliable feature-based signal it's
    // WebKit without dragging in UA string parsing.
    const looksLikeWebkit = 'webkitAudioContext' in window && !('chrome' in window);
    mic.title = looksLikeWebkit
      ? "Voice input isn't supported in Safari — try Chrome, or type your question."
      : 'Voice input is not supported in this browser';
    mic.style.opacity = '0.4';
    return;
  }
  const rec = new SpeechRec();
  rec.lang = state.lang === 'hi' ? 'hi-IN' : 'en-IN';
  rec.interimResults = false;
  mic.addEventListener('click', () => {
    const pressed = mic.getAttribute('aria-pressed') === 'true';
    if (pressed) { rec.stop(); return; }
    rec.lang = state.lang === 'hi' ? 'hi-IN' : 'en-IN';
    try { rec.start(); mic.setAttribute('aria-pressed', 'true'); } catch (e) { /* already started */ }
  });
  rec.addEventListener('result', (e) => {
    const text = e.results[0][0].transcript;
    document.getElementById('chat-input').value = text;
    runQuery({ text });
  });
  rec.addEventListener('end', () => mic.setAttribute('aria-pressed', 'false'));
  rec.addEventListener('error', () => { mic.setAttribute('aria-pressed', 'false'); toast('Voice input could not be captured.'); });
}

function init() {
  loadPrefs();
  setupNav();
  setupConnectivityBanner();
  setupNavDropdowns();
  setupGeolocation();
  setupTabs();
  renderStructuredControls();
  renderSuggestions();
  setupChatForm();
  applyTranslations(document, state.lang);
  runQuery({});
  checkNotifyThresholds();
}

document.addEventListener('DOMContentLoaded', init);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* non-fatal */ });
  });
}
