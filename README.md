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
```

## Data sources — what is live and what isn't

| Section | Source | Status |
|---|---|---|
| Forecast (current/hourly/daily) | [Open-Meteo](https://open-meteo.com) forecast API, queried across three independent models (ECMWF IFS, NOAA GFS, DWD ICON) | **Live** |
| Model agreement / confidence | Computed from the real spread across the three models above | **Live**, computed |
| Location search | Open-Meteo geocoding API | **Live** |
| Climate / historical trends | Open-Meteo historical archive (ERA5 reanalysis) | **Live** |
| Warnings | Threshold rules applied to the live forecast above (rainfall, wind, heat) | **Derived, not official.** This is explicitly labelled everywhere it appears — it is *not* an IMD warning feed. There is no public, keyless, CORS-enabled IMD warnings API to wire in for a static demo; `js/api.js` is structured so a real IMD endpoint can replace the threshold check without any UI changes. |

If a live call fails, the UI shows an explicit "temporarily unavailable" state with a retry action —
it never fabricates a reading. Forecast responses are cached in memory for 10 minutes per location to
avoid redundant calls; when a cached response is shown, it's labelled "cached" with its original
timestamp.

## Running it

No installation required.

```
# from the project folder
python3 -m http.server 8080
# then open http://localhost:8080
```

Or open `index.html` directly in a browser. An internet connection is required for live data
(Open-Meteo has no API key / auth requirement).

## Known limitations

- Warnings are a derived risk indicator, not an official IMD feed (see table above).
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
