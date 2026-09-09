// ==========================================================================
// WeatherGPT — Data layer
// Open-Meteo is used as the live backbone (no key required). Every function
// here either returns real retrieved data or throws — nothing is invented.
// Swapping in an IMD endpoint later means changing this file only.
// ==========================================================================

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

const MODELS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless'];

const CACHE_PREFIX = 'wx_cache_forecast_';

function cacheKey(lat, lon) {
  return `${CACHE_PREFIX}${lat.toFixed(3)},${lon.toFixed(3)}`;
}

function readForecastCache(lat, lon) {
  try {
    const raw = localStorage.getItem(cacheKey(lat, lon));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Dates don't survive JSON — rehydrate the ones normalizeForecast() produces.
    parsed.fetchedAt = new Date(parsed.fetchedAt);
    parsed.hourly.forEach((h) => { h.date = new Date(h.date); });
    parsed.daily.forEach((d) => { d.date = new Date(d.date); });
    return parsed;
  } catch (e) {
    return null;
  }
}

function writeForecastCache(lat, lon, data) {
  try {
    localStorage.setItem(cacheKey(lat, lon), JSON.stringify(data));
  } catch (e) {
    // localStorage full or unavailable (private browsing) — fail silently, this is best-effort.
  }
}

async function getJSON(url, params, { timeoutMs = 12000 } = {}) {
  const qs = new URLSearchParams(params).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}?${qs}`, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Request failed (${res.status})`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function geocode(name, count = 8) {
  const data = await getJSON(GEOCODE_URL, { name, count, language: 'en', format: 'json' });
  return (data.results || []).map((r) => ({
    id: `${r.id}`,
    name: r.name,
    admin1: r.admin1 || '',
    country: r.country || '',
    countryCode: r.country_code || '',
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone,
  }));
}

/**
 * Pulls current + hourly + daily forecast across several independent
 * models (ECMWF, GFS, ICON) so real model agreement/disagreement can be
 * computed rather than displayed as a fixed number.
 */
export async function fetchForecast(lat, lon) {
  const params = {
    latitude: lat,
    longitude: lon,
    current: 'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,relative_humidity_2m',
    hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,relative_humidity_2m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,uv_index_max',
    models: MODELS.join(','),
    timezone: 'auto',
    forecast_days: 8,
  };
  try {
    const data = await getJSON(FORECAST_URL, params);
    const normalized = normalizeForecast(data);
    writeForecastCache(lat, lon, normalized);
    return normalized;
  } catch (err) {
    const cached = readForecastCache(lat, lon);
    if (cached) return { ...cached, isStale: true };
    throw err;
  }
}

function pickModelSeries(obj, base, index) {
  // Open-Meteo suffixes each requested variable with the model id when
  // multiple models are requested, e.g. temperature_2m_ecmwf_ifs025.
  return MODELS.map((m) => {
    const key = `${base}_${m}`;
    const arr = obj[key];
    return arr ? arr[index] : null;
  });
}

function normalizeForecast(raw) {
  const tz = raw.timezone;
  const hourlyTimes = (raw.hourly && raw.hourly.time) || [];
  const dailyTimes = (raw.daily && raw.daily.time) || [];

  const hourly = hourlyTimes.map((t, i) => {
    const modelsTemp = pickModelSeries(raw.hourly, 'temperature_2m', i);
    const modelsPop = pickModelSeries(raw.hourly, 'precipitation_probability', i);
    const modelsPrecip = pickModelSeries(raw.hourly, 'precipitation', i);
    return {
      time: t,
      date: new Date(t),
      temperature: avgOrNull(modelsTemp),
      pop: avgOrNull(modelsPop),
      precipitation: avgOrNull(modelsPrecip),
      weatherCode: pickModelSeries(raw.hourly, 'weather_code', i)[0],
      windSpeed: avgOrNull(pickModelSeries(raw.hourly, 'wind_speed_10m', i)),
      humidity: avgOrNull(pickModelSeries(raw.hourly, 'relative_humidity_2m', i)),
      models: { temperature: modelsTemp, pop: modelsPop, precipitation: modelsPrecip },
    };
  });

  const daily = dailyTimes.map((t, i) => {
    const modelsMax = pickModelSeries(raw.daily, 'temperature_2m_max', i);
    const modelsMin = pickModelSeries(raw.daily, 'temperature_2m_min', i);
    const modelsPrecipSum = pickModelSeries(raw.daily, 'precipitation_sum', i);
    const modelsPop = pickModelSeries(raw.daily, 'precipitation_probability_max', i);
    return {
      time: t,
      date: new Date(t),
      tempMax: avgOrNull(modelsMax),
      tempMin: avgOrNull(modelsMin),
      precipSum: avgOrNull(modelsPrecipSum),
      pop: avgOrNull(modelsPop),
      weatherCode: pickModelSeries(raw.daily, 'weather_code', i)[0],
      windMax: avgOrNull(pickModelSeries(raw.daily, 'wind_speed_10m_max', i)),
      uv: avgOrNull(pickModelSeries(raw.daily, 'uv_index_max', i)),
      models: { tempMax: modelsMax, precipSum: modelsPrecipSum, pop: modelsPop },
    };
  });

  return {
    timezone: tz,
    fetchedAt: new Date(),
    current: raw.current || null,
    hourly,
    daily,
    modelIds: MODELS,
  };
}

function avgOrNull(arr) {
  const v = arr.filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/**
 * Historical daily archive, used for the Climate view. Returns raw daily
 * series for the requested date range so the caller can compute averages,
 * anomalies, and trend lines from real observed/reanalysis data.
 */
export async function fetchArchive(lat, lon, startDate, endDate) {
  const params = {
    latitude: lat,
    longitude: lon,
    start_date: startDate,
    end_date: endDate,
    daily: 'temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_sum',
    timezone: 'auto',
  };
  const data = await getJSON(ARCHIVE_URL, params, { timeoutMs: 20000 });
  const times = (data.daily && data.daily.time) || [];
  return times.map((t, i) => ({
    date: t,
    tempMean: data.daily.temperature_2m_mean ? data.daily.temperature_2m_mean[i] : null,
    tempMax: data.daily.temperature_2m_max ? data.daily.temperature_2m_max[i] : null,
    tempMin: data.daily.temperature_2m_min ? data.daily.temperature_2m_min[i] : null,
    precip: data.daily.precipitation_sum ? data.daily.precipitation_sum[i] : null,
  }));
}
