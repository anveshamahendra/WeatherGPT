# WeatherGPT

Conversational weather intelligence for SIH26068 (Ministry of Earth Sciences / IMD, Disaster Management theme).

Ask a plain-language weather question — or use the structured controls — and get a warning-first,
source-attributed, uncertainty-aware answer. Built as a dependency-free static site so it runs
anywhere with no build step: open `index.html`, or serve the folder, and it works.

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
server.js               Node.js server — serves static assets + /api/weather-alerts endpoint
server/imd-poller.js    Polls IMD CAP 1.2 RSS feed, parses alerts, manages cache
data/imd-alerts-cache.json  Persisted IMD alert cache (auto-generated)
sw.js                   Service worker for offline shell caching
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
static frontend and the IMD alerts API. It requires zero `npm install` — only built-in Node
modules and the native `fetch` API are used.

```
# from the project folder
node server.js
# then open http://localhost:8080
```

The server listens on port 8080 by default (override with `PORT` env var). The IMD alerts
section on the Warnings page requires the server to be running, because `/api/weather-alerts`
does not exist under `file://` or a plain static file server (e.g. `python3 -m http.server`).
Forecast and climate features work fine without the server, as they hit Open-Meteo directly from
the browser.

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

## Design system

Warm "meteorological observatory" palette (ivory / parchment / walnut / antique gold), an editorial
serif (Fraunces) for statements and headings, Inter for interface text, IBM Plex Mono for timestamps
and technical values. Full token list in `css/tokens.css`.
