// js/map.js — IMD alert polygon map (Leaflet, ES module)

let map = null;
let polygonLayer = null;
let legendControl = null;
const guidPolygonMap = new Map();

/** Severity → fill/stroke color (matches imd-alert badge palette) */
function severityColors(severity) {
  switch (severity) {
    case 'Extreme':  return { fill: '#8A2E22', stroke: '#6B1F15', opacity: 0.55 };
    case 'Severe':   return { fill: '#B5561A', stroke: '#8E4215', opacity: 0.45 };
    case 'Moderate': return { fill: '#9C6414', stroke: '#7A4E10', opacity: 0.40 };
    case 'Minor':    return { fill: '#4B6B4E', stroke: '#3A5440', opacity: 0.35 };
    default:         return { fill: '#6E6154', stroke: '#5A4E43', opacity: 0.30 };
  }
}

/** Parse a CAP polygon string ("lat,lon lat,lon …") into [[lat,lon],…] */
function parsePolygon(str) {
  if (!str || typeof str !== 'string') return [];
  return str.trim().split(/\s+/).map((pair) => {
    const parts = pair.split(',');
    if (parts.length < 2) return null;
    const lat = parseFloat(parts[0]);
    const lon = parseFloat(parts[1]);
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
  }).filter(Boolean);
}

/** Format an ISO timestamp for popup display */
function fmtTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' '
         + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return iso; }
}

/** Build the popup HTML for an alert */
function buildPopupHtml(alert) {
  const colors = severityColors(alert.severity);
  const timeWindow = alert.expires
    ? `${fmtTime(alert.onset || alert.sent)} – ${fmtTime(alert.expires)}`
    : fmtTime(alert.sent);
  return `
    <div class="map-popup">
      <span class="map-popup__severity" style="background:${colors.fill}">${escapeHtml(alert.severity || 'Unknown')}</span>
      <div class="map-popup__headline">${escapeHtml(alert.headline || alert.event || 'Severe Weather Warning')}</div>
      <div class="map-popup__meta">
        ${alert.event ? `<div>${escapeHtml(alert.event)}</div>` : ''}
        <div>${escapeHtml(alert.areaDesc || 'India')}</div>
        ${timeWindow ? `<div>${escapeHtml(timeWindow)}</div>` : ''}
      </div>
      ${alert.link ? `<a class="map-popup__link" href="${escapeHtml(alert.link)}" target="_blank" rel="noopener">View full alert →</a>` : ''}
    </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Show a fallback message inside the map container */
function showMapFallback(container, type, title, body) {
  container.innerHTML = `
    <div class="map-fallback map-fallback--${type}">
      <p class="map-fallback__title">${title}</p>
      <p class="map-fallback__body">${body}</p>
    </div>`;
}

/** Create the legend control */
function createLegend() {
  const items = [
    { label: 'Extreme', color: '#8A2E22' },
    { label: 'Severe',  color: '#B5561A' },
    { label: 'Moderate', color: '#9C6414' },
    { label: 'Minor',   color: '#4B6B4E' },
  ];
  const div = L.DomUtil.create('div', 'map-legend');
  div.setAttribute('role', 'img');
  div.setAttribute('aria-label', 'Map legend: alert severity colors');
  div.innerHTML = items.map((i) =>
    `<div class="map-legend__item"><span class="map-legend__swatch" style="background:${i.color}"></span>${i.label}</div>`
  ).join('');
  return div;
}

/**
 * Initialise the Leaflet map inside the given container.
 * Safe to call multiple times (no-ops if already initialised).
 */
export function initAlertsMap(containerId = 'alerts-map') {
  if (map) return;

  if (typeof L === 'undefined') {
    const el = document.getElementById(containerId);
    if (el) showMapFallback(el, 'error', 'Map unavailable', 'Mapping library failed to load — showing list only.');
    return;
  }

  const container = document.getElementById(containerId);
  if (!container) return;

  // Check container has dimensions (hidden views have 0 height)
  if (!container.offsetHeight) return;

  try {
    map = L.map(container, {
      zoomControl: true,
      attributionControl: false,
      scrollWheelZoom: false,
      dragging: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 18,
      subdomains: 'abcd',
    }).addTo(map);

    polygonLayer = L.layerGroup().addTo(map);

    // Attribution line inside the container
    const attrDiv = document.createElement('div');
    attrDiv.className = 'map-attribution';
    attrDiv.innerHTML = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · Tiles © <a href="https://carto.com/" target="_blank" rel="noopener">CARTO</a>';
    container.appendChild(attrDiv);

    // Legend
    legendControl = L.control({ position: 'bottomright' });
    legendControl.onAdd = createLegend;
    legendControl.addTo(map);

    // Fix layout after container becomes visible
    setTimeout(() => map && map.invalidateSize(), 100);
  } catch (e) {
    showMapFallback(container, 'error', 'Map unavailable', 'The map could not be initialised — showing list only.');
    map = null;
  }
}

/**
 * Replace all polygons on the map with the given alerts array.
 * Each alert should have: polygon, severity, guid, headline, event,
 * areaDesc, onset, expires, link, sent.
 */
export function updateAlertsMap(alerts = []) {
  if (!map || !polygonLayer) {
    // Leaflet not loaded — ensure fallback is shown
    const el = document.getElementById('alerts-map');
    if (el && !el.querySelector('.leaflet-container')) {
      if (typeof L === 'undefined') {
        showMapFallback(el, 'error', 'Map unavailable', 'Mapping library failed to load — showing list only.');
      } else if (!alerts.length || !alerts.some((a) => parsePolygon(a.polygon).length > 0)) {
        showMapFallback(el, 'empty', 'No active alert zones', 'No IMD alerts with polygon data to display on the map.');
      }
    }
    return;
  }

  polygonLayer.clearLayers();
  guidPolygonMap.clear();

  const validAlerts = alerts.filter((a) => {
    const coords = parsePolygon(a.polygon);
    return coords.length >= 3;
  });

  if (!validAlerts.length) {
    // Keep the map visible (user can still see India), but note empty state
    const el = document.getElementById('alerts-map');
    if (el) {
      // Remove any previous fallback
      const fb = el.querySelector('.map-fallback');
      if (fb) fb.remove();
    }
    map.setView([22.5, 80], 4.5);
    return;
  }

  const bounds = [];

  validAlerts.forEach((alert) => {
    const coords = parsePolygon(alert.polygon);
    const colors = severityColors(alert.severity);

    const polygon = L.polygon(coords, {
      color: colors.stroke,
      weight: 2,
      fillColor: colors.fill,
      fillOpacity: colors.opacity,
    });

    polygon.bindPopup(buildPopupHtml(alert), { maxWidth: 300 });
    polygonLayer.addLayer(polygon);
    guidPolygonMap.set(alert.guid, { polygon, alert });
    bounds.push(...coords);
  });

  // Fit bounds with padding
  if (bounds.length) {
    map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 10 });
  }
}

/**
 * Pan/zoom the map to the polygon matching the given guid and open its popup.
 * Called when a list card is clicked.
 */
export function panToAlert(guid) {
  if (!map || !guidPolygonMap.has(guid)) return;
  const entry = guidPolygonMap.get(guid);
  const latlngs = entry.polygon.getLatLngs()[0];
  const bounds = L.latLngBounds(latlngs);
  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 9, animate: true, duration: 0.5 });
  entry.polygon.openPopup();
}
