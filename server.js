/**
 * ============================================================================
 * WeatherGPT Server & API
 * ============================================================================
 * 
 * Provides:
 *  - GET  /api/weather-alerts          : Active IMD severe weather warnings (JSON)
 *  - GET  /api/health                  : Service health and poller status
 *  - GET  /api/push/vapid-public-key   : VAPID public key for Web Push
 *  - POST /api/push/subscribe          : Register a push subscription
 *  - POST /api/push/unsubscribe        : Remove a push subscription
 *  - Static file hosting for WeatherGPT frontend
 * ============================================================================
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import webPush from 'web-push';
import { ImdAlertsService } from './server/imd-poller.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Environment — load .env if present (Node 20.6+ built-in, no dotenv needed)
// ---------------------------------------------------------------------------
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch (_) { /* no .env file — use env vars or defaults */ }

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';

// ---------------------------------------------------------------------------
// VAPID / Web Push setup
// ---------------------------------------------------------------------------
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:weathergpt@example.com';

const pushEnabled = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (pushEnabled) {
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  console.log('[Push] Web Push (VAPID) enabled.');
} else {
  console.warn('[Push] VAPID keys not set — push notifications disabled. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY in .env or environment.');
}

// ---------------------------------------------------------------------------
// Push subscription storage  (flat JSON, same pattern as imd-alerts-cache.json)
// ---------------------------------------------------------------------------
const SUBS_DIR = path.join(__dirname, 'data');
const SUBS_FILE = path.join(SUBS_DIR, 'push-subscriptions.json');
let pushSubscriptions = new Map(); // endpoint -> { subscription, location, minSeverity }

function loadSubscriptionsFromDisk() {
  try {
    if (fs.existsSync(SUBS_FILE)) {
      const raw = fs.readFileSync(SUBS_FILE, 'utf-8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (const entry of arr) {
          if (entry && entry.subscription && entry.subscription.endpoint) {
            pushSubscriptions.set(entry.subscription.endpoint, entry);
          }
        }
      }
    }
    console.log(`[Push] Loaded ${pushSubscriptions.size} subscription(s) from disk.`);
  } catch (err) {
    console.warn(`[Push] Could not load subscriptions: ${err.message}`);
  }
}

function saveSubscriptionsToDisk() {
  try {
    if (!fs.existsSync(SUBS_DIR)) fs.mkdirSync(SUBS_DIR, { recursive: true });
    const arr = Array.from(pushSubscriptions.values());
    fs.writeFileSync(SUBS_FILE, JSON.stringify(arr, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[Push] Could not save subscriptions: ${err.message}`);
  }
}

loadSubscriptionsFromDisk();

// ---------------------------------------------------------------------------
// Send push notification (exported for imd-poller to call)
// ---------------------------------------------------------------------------
export async function sendPushNotification(subscription, payload) {
  if (!pushEnabled) return;
  try {
    await webPush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: 60 * 60, // 1 hour
    });
    return true;
  } catch (err) {
    // 404 / 410 = subscription expired or removed by the push service
    if (err.statusCode === 404 || err.statusCode === 410) {
      console.log(`[Push] Subscription expired (HTTP ${err.statusCode}), removing: ${subscription.endpoint.slice(0, 60)}...`);
      pushSubscriptions.delete(subscription.endpoint);
      saveSubscriptionsToDisk();
    } else {
      console.warn(`[Push] sendNotification failed: ${err.message}`);
    }
    return false;
  }
}

// Expose subscriptions and persistence for the poller
export function getPushSubscriptions() {
  return pushSubscriptions;
}

export function persistSubscriptions() {
  saveSubscriptionsToDisk();
}

// ---------------------------------------------------------------------------
// MIME types for static assets
// ---------------------------------------------------------------------------
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

// ---------------------------------------------------------------------------
// IMD Alerts Background Poller (12-minute cycle)
// ---------------------------------------------------------------------------
const imdService = new ImdAlertsService({
  pollIntervalMs: 12 * 60 * 1000,
  onNewAlert: pushEnabled ? sendAlertPushNotifications : undefined,
});

imdService.start();

// ---------------------------------------------------------------------------
// Push notification dispatch for new/escalated IMD alerts
// ---------------------------------------------------------------------------

const SEVERITY_ORDER = { 'Unknown': 0, 'Minor': 1, 'Moderate': 2, 'Severe': 3, 'Extreme': 4 };

/**
 * Parse a CAP polygon string ("lat,lon lat,lon ...") into an array of {lat, lon}
 */
function parsePolygon(polygonStr) {
  if (!polygonStr) return [];
  return polygonStr.trim().split(/\s+/).map((pair) => {
    const [lat, lon] = pair.split(',').map(Number);
    return { lat, lon };
  });
}

/**
 * Point-in-polygon test (ray casting algorithm)
 */
function pointInPolygon(lat, lon, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat, yi = polygon[i].lon;
    const xj = polygon[j].lat, yj = polygon[j].lon;
    const intersect = ((yi > lon) !== (yj > lon)) &&
      (lat < (xj - xi) * (lon - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

async function sendAlertPushNotifications(alert, _existingAlert) {
  if (!pushEnabled) return;
  const subs = Array.from(pushSubscriptions.values());
  if (!subs.length) return;

  const alertSevWeight = SEVERITY_ORDER[alert.severity] || 0;
  const polygon = parsePolygon(alert.polygon);

  for (const sub of subs) {
    // Check severity threshold
    const minSevWeight = SEVERITY_ORDER[sub.minSeverity] || 0;
    if (alertSevWeight < minSevWeight) continue;

    // Check location inside polygon (if polygon exists)
    if (polygon.length >= 3) {
      const loc = sub.location;
      if (loc && loc.latitude != null && loc.longitude != null) {
        if (!pointInPolygon(loc.latitude, loc.longitude, polygon)) continue;
      }
    }

    const payload = {
      title: `IMD Alert: ${alert.event || 'Severe Weather Warning'}`,
      body: `${alert.headline || alert.event || 'Severe weather alert'} — ${alert.areaDesc || 'India'}. Severity: ${alert.severity}.`,
      severity: alert.severity,
      link: alert.link || '',
      guid: alert.guid || '',
    };

    console.log(`[Push] Sending to ${sub.location?.name || 'unknown'} (${sub.subscription.endpoint.slice(0, 40)}...)`);
    await sendPushNotification(sub.subscription, payload);
  }
}

// ---------------------------------------------------------------------------
// Helper: read JSON POST body
// ---------------------------------------------------------------------------
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  // Intentionally open CORS for hackathon demo/judge access
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // --------------------------------------------------------------------------
  // API: GET /api/weather-alerts
  // --------------------------------------------------------------------------
  if (pathname === '/api/weather-alerts') {
    try {
      const area = parsedUrl.searchParams.get('area') || '';
      const severity = parsedUrl.searchParams.get('severity') || '';
      const forceRefresh = parsedUrl.searchParams.get('refresh') === 'true';

      if (forceRefresh) {
        await imdService.refreshNow();
      }

      const activeAlerts = imdService.getActiveAlerts({ area, severity });

      const responsePayload = {
        status: 'success',
        source: 'India Meteorological Department (IMD)',
        attribution: 'Data provided by India Meteorological Department under public domain CAP 1.2 feed',
        officialUrl: 'https://mausam.imd.gov.in/',
        fetchedAt: imdService.lastFetchedAt || new Date().toISOString(),
        count: activeAlerts.length,
        filter: {
          area: area || null,
          severity: severity || null,
        },
        alerts: activeAlerts,
      };

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
      });
      res.end(JSON.stringify(responsePayload, null, 2));
    } catch (err) {
      console.error('[API Error] /api/weather-alerts:', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'error', message: err.message }));
    }
    return;
  }

  // --------------------------------------------------------------------------
  // API: GET /api/health
  // --------------------------------------------------------------------------
  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      status: 'healthy',
      totalCached: imdService.alertsMap.size,
      activeAlerts: imdService.getActiveAlerts().length,
      lastFetchedAt: imdService.lastFetchedAt,
      pushEnabled,
      subscriptions: pushSubscriptions.size,
      uptimeSeconds: Math.round(process.uptime()),
    }));
    return;
  }

  // --------------------------------------------------------------------------
  // API: GET /api/push/vapid-public-key
  // --------------------------------------------------------------------------
  if (pathname === '/api/push/vapid-public-key') {
    if (!pushEnabled) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'error', message: 'Push notifications not configured (VAPID keys missing)' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(VAPID_PUBLIC_KEY);
    return;
  }

  // --------------------------------------------------------------------------
  // API: POST /api/push/subscribe
  // --------------------------------------------------------------------------
  if (pathname === '/api/push/subscribe' && req.method === 'POST') {
    if (!pushEnabled) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'error', message: 'Push notifications not configured' }));
      return;
    }
    try {
      const body = await readJsonBody(req);
      const { subscription, location, minSeverity } = body;
      if (!subscription || !subscription.endpoint) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ status: 'error', message: 'Missing or invalid subscription' }));
        return;
      }
      const validSeverities = ['Moderate', 'Severe', 'Extreme'];
      const severity = validSeverities.includes(minSeverity) ? minSeverity : 'Severe';

      pushSubscriptions.set(subscription.endpoint, {
        subscription,
        location: location || { name: 'Unknown', latitude: null, longitude: null },
        minSeverity: severity,
        subscribedAt: new Date().toISOString(),
      });
      saveSubscriptionsToDisk();
      console.log(`[Push] Subscription added/updated: ${subscription.endpoint.slice(0, 60)}... (location: ${location?.name || 'unknown'}, severity: ${severity})`);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'success', message: 'Subscription stored' }));
    } catch (err) {
      console.error('[API Error] /api/push/subscribe:', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'error', message: err.message }));
    }
    return;
  }

  // --------------------------------------------------------------------------
  // API: POST /api/push/unsubscribe
  // --------------------------------------------------------------------------
  if (pathname === '/api/push/unsubscribe' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const { endpoint } = body;
      if (!endpoint) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ status: 'error', message: 'Missing endpoint' }));
        return;
      }
      const removed = pushSubscriptions.delete(endpoint);
      if (removed) saveSubscriptionsToDisk();
      console.log(`[Push] Subscription ${removed ? 'removed' : 'not found'}: ${endpoint.slice(0, 60)}...`);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'success', removed }));
    } catch (err) {
      console.error('[API Error] /api/push/unsubscribe:', err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ status: 'error', message: err.message }));
    }
    return;
  }

  // --------------------------------------------------------------------------
  // Static File Serving
  // --------------------------------------------------------------------------
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '\\') safePath = '/index.html';

  const filePath = path.join(__dirname, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`=======================================================`);
  console.log(` WeatherGPT Server with IMD Warnings Poller Active`);
  console.log(` Local URL:    http://localhost:${PORT}`);
  console.log(` Alerts API:   http://localhost:${PORT}/api/weather-alerts`);
  console.log(` Health Check: http://localhost:${PORT}/api/health`);
  if (pushEnabled) {
    console.log(` Push API:     http://localhost:${PORT}/api/push/vapid-public-key`);
  } else {
    console.log(` Push:         DISABLED (set VAPID keys in .env to enable)`);
  }
  console.log(`=======================================================`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nStopping WeatherGPT server...');
  imdService.stop();
  server.close(() => process.exit(0));
});
