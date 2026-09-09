/**
 * ============================================================================
 * WeatherGPT Server & API
 * ============================================================================
 * 
 * Provides:
 *  - GET /api/weather-alerts : Active IMD severe weather warnings (JSON)
 *  - GET /api/health         : Service health and poller status
 *  - Static file hosting for WeatherGPT frontend (index.html, css/, js/)
 * ============================================================================
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ImdAlertsService } from './server/imd-poller.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';

// MIME types for static assets
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

// Initialize IMD Alerts Background Poller (12-minute cycle)
const imdService = new ImdAlertsService({
  pollIntervalMs: 12 * 60 * 1000,
});

// Start background fetching
imdService.start();

/**
 * Request handler
 */
const server = http.createServer(async (req, res) => {
  // Intentionally open CORS for hackathon demo/judge access — not a production security posture.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
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
  // Returns active, non-expired IMD severe weather warnings
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
        'Cache-Control': 'public, max-age=60', // Cache on client for 60s
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
      uptimeSeconds: Math.round(process.uptime()),
    }));
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
      // 404 Not Found
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
  console.log(`=======================================================`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nStopping WeatherGPT server...');
  imdService.stop();
  server.close(() => process.exit(0));
});
