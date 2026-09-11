# WeatherGPT

Conversational weather intelligence for SIH26068 (Ministry of Earth Sciences / IMD, Disaster Management theme).

Ask a plain-language weather question — or use the structured controls — and get a warning-first,
source-attributed, uncertainty-aware answer. Built as a plain HTML/CSS/JS site with no build step:
open `index.html`, or serve the folder, and it works. The server (`server.js`) adds IMD alert
polling and Web Push notifications for severe weather — run `npm install` once to enable these.

## Overview

WeatherGPT is a conversational **layer over existing weather data**, not a new forecasting model.
The pipeline is:

```
question (typed / voice / dropdowns)
  → intent + location + time-window parsing        (js/utils.js)
  → live data retrieval, 3 independent models        (js/api.js)
  → risk-threshold check (warning-first)              (js/app.js)
  → plain-language statement + evidence + source       (js/app.js)
```

The interpretation layer never invents a number, a warning, or a confidence score — every value
you see was returned by the API call visible in the Evidence ("Why?") panel.

## Architecture

Plain HTML/CSS/JS, ES modules, no framework and no build step:

```
index.html            All views (Ask, Warnings, Climate, About), icon sprite
css/tokens.css         Design tokens (colour, type, spacing, radius, shadow)
css/base.css            Reset + typography
css/nav-hero.css        Navigation + hero + instrument dial
css/station.css         Query station, dropdowns, buttons, chat input
css/results.css         Results, evidence panel, warnings, climate, tables
js/utils.js             Formatting, WMO weather-code map, time-window rules, query parser
js/api.js               Open-Meteo geocoding / forecast / archive calls — the only file that
                         talks to the network; swap in an IMD endpoint here without touching the UI
js/dropdown.js          Reusable accessible listbox/combobox component
js/i18n.js              English/Hindi string table
js/app.js               State, view routing, query pipeline, rendering
server.js               Node.js server — serves static assets, /api/weather-alerts, and Web Push endpoints
server/db.js            SQLite database layer (better-sqlite3) — prepared statements for alerts and subscriptions
server/imd-poller.js    Polls IMD CAP 1.2 RSS feed, parses alerts, manages cache, dispatches push notifications
data/weathergpt.db      SQLite database (auto-created) — IMD alert cache and push subscriptions
sw.js                   Service worker for offline shell caching + push notification display
```

## Data sources — what is live and what isn't

| Section | Source | Status |
|---|---|---|
| Forecast (current/hourly/daily) | [Open-Meteo](https://open-meteo.com) forecast API, queried across three independent models (ECMWF IFS, NOAA GFS, DWD ICON) | **Live** |
| Model agreement / confidence | Computed from the real spread across the three models above | **Live**, computed |
| Location search | Open-Meteo geocoding API | **Live** |
| Climate / historical trends | Open-Meteo historical archive (ERA5 reanalysis) | **Live** |
| IMD severe weather alerts | India Meteorological Department CAP 1.2 RSS feed, polled server-side every 12 minutes and served via `/api/weather-alerts` | **Live**, server-polled |
| Derived risk indicator | Threshold rules applied to the live forecast above (rainfall, wind, heat) | **Derived, not official.** This is explicitly labelled everywhere it appears — it is *not* an IMD warning feed. |

If a live call fails, the UI shows an explicit "temporarily unavailable" state with a retry action —
it never fabricates a reading. Forecast responses are cached in memory for 10 minutes per location to
avoid redundant calls; when a cached response is shown, it's labelled "cached" with its original
timestamp.

## Running it

The primary way to run WeatherGPT is with the included Node.js server, which provides both the
static frontend, the IMD alerts API, and Web Push notifications for severe weather alerts.

### One-time setup

```bash
npm install

# Generate VAPID keys for Web Push (one-time, outputs a public + private key pair)
npx web-push generate-vapid-keys

# Copy the keys into a .env file (see .env.example for the format)
# Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT in .env
```

### Starting the server

```bash
# from the project folder
node server.js
# then open http://localhost:8080
```

The server listens on port 8080 by default (override with `PORT` env var). The IMD alerts
section on the Warnings page requires the server to be running, because `/api/weather-alerts`
does not exist under `file://` or a plain static file server (e.g. `python3 -m http.server`).
Forecast and climate features work fine without the server, as they hit Open-Meteo directly from
the browser.

If VAPID keys are not configured, the server still runs normally — push notifications are simply
unavailable while all other features (forecasts, climate, in-tab alerts) continue to work.

## Packaging for submission

To create a submission archive without the `.git/` directory, run:

```
npm run package
```

This creates `weathergpt.tar.gz` in the parent directory, excluding the `.git` folder. On Windows, you can also use `tar` from Git Bash or use PowerShell's `Compress-Archive` with appropriate exclusions.

## Known limitations

- The derived risk indicator shown on the Warnings page is computed from forecast thresholds, not an official IMD feed (see table above).
- Voice input uses the browser's native `SpeechRecognition` API where available (Chrome/Edge); it is
  not supported in every browser and degrades to a disabled button with an explanatory title when absent.
- Hindi coverage is limited to interface labels and suggested questions listed in `js/i18n.js`, not a
  full translation of generated answer text — nothing is claimed as translated beyond what's implemented.
- Time-window resolution (e.g. "tomorrow evening" → 17:00–21:00) follows an explicit fixed rule table
  in `js/utils.js`, not free-form NLP — deliberately, so the mapping from question to query is always
  auditable.

## Data persistence

All server-owned state lives in a single SQLite database file (`data/weathergpt.db`) powered by
`better-sqlite3` — a synchronous, embedded, zero-cost library with no external server process,
no network calls, and no usage-based billing. The database is created automatically on first
startup and uses WAL mode for safe concurrent reads/writes between the poller and API routes.

**Two tables are stored in the database:**
- `imd_alerts` — the IMD alert cache (replaces the former `data/imd-alerts-cache.json`)
- `push_subscriptions` — push notification registrations (replaces the former `data/push-subscriptions.json`)

**Migration note:** If `data/imd-alerts-cache.json` still exists on disk when this is first
deployed, its content is safe to discard — the poller re-fetches the full alert set from the IMD
RSS feed within one poll cycle (12 minutes) regardless, so nothing is lost by starting the SQLite
table empty. Push subscriptions, if present, are **not** recoverable this way (they came from
users' browsers) — anyone who had opted in would need to re-enable notifications after a redeploy
that wipes the database.

**Ephemeral filesystem caveat:** If deployed to a host with an ephemeral disk (e.g. Render's free
web service tier), the database resets on every redeploy or restart. The IMD alert cache self-heals
within 12 minutes either way. Push subscriptions do **not** self-heal — anyone who had opted in
would need to re-enable notifications after a redeploy on such a host. If continuous push delivery
matters, either use a host with a persistent volume (Railway's persistent volumes, Render's paid
persistent disks, or a small VPS) or accept this as a known limitation for a free-tier deployment.

## Design system

Warm "meteorological observatory" palette (ivory / parchment / walnut / antique gold), an editorial
serif (Fraunces) for statements and headings, Inter for interface text, IBM Plex Mono for timestamps
and technical values. Full token list in `css/tokens.css`.
