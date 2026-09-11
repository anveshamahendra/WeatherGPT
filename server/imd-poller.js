/**
 * ============================================================================
 * WeatherGPT — India Meteorological Department (IMD) Severe Weather Poller
 * ============================================================================
 * 
 * Data Source:
 *   RSS Index: https://cap-sources.s3.amazonaws.com/in-imd-en/rss.xml
 *   Standard:  Common Alerting Protocol (CAP) v1.2 / OASIS Standard
 * 
 * CAP 1.2 XML Fields Overview:
 * ----------------------------------------------------------------------------
 * - identifier : Unique identifier for this alert message.
 * - sender     : Originator ID (e.g., rainfallnwfc@gmail.com).
 * - sent       : Time alert was originated (ISO 8601).
 * - status     : 'Actual' (live alert), 'Exercise', 'System', 'Test', 'Draft'.
 * - msgType    : 'Alert' (initial), 'Update' (revision), 'Cancel' (rescinded).
 * - scope      : 'Public', 'Restricted', 'Private'.
 * 
 * <info> block fields:
 * - category   : 'Met' (Meteorological), 'Safety', 'Security', etc.
 * - event      : Type of hazard (e.g., 'Extremely heavy rainfall', 'Cyclone').
 * - urgency    : 'Immediate', 'Expected', 'Future', 'Past', 'Unknown'.
 * - severity   : 'Extreme' (Extraordinary threat to life/property),
 *                'Severe' (Significant threat),
 *                'Moderate' (Possible threat),
 *                'Minor' (Minimal threat),
 *                'Unknown'.
 * - certainty  : 'Observed', 'Likely', 'Possible', 'Unlikely', 'Unknown'.
 * - onset      : Expected beginning of the event.
 * - expires    : Expiry timestamp of the warning.
 * - senderName : Issuing office (e.g., 'NWFC DIVISION, IMD, NEW DELHI').
 * - headline   : Brief, actionable summary phrase.
 * - description: Detailed meteorological description of the hazard.
 * - instruction: Public safety advisories and recommended protective actions.
 * - area       : Contains <areaDesc> (e.g. 'ODISHA') and optional <polygon> coordinates.
 * ============================================================================
 */

import { getAllAlerts, upsertAlert, pruneExpiredAlerts } from './db.js';

// IMD Public CAP RSS feed URL
const RSS_URL = 'https://cap-sources.s3.amazonaws.com/in-imd-en/rss.xml';

// Polling interval in milliseconds (12 minutes default — between 10-15 mins to respect IMD servers)
const DEFAULT_POLL_INTERVAL_MS = 12 * 60 * 1000;

// Severity weight mapping for sorting (higher = more critical)
const SEVERITY_WEIGHTS = {
  'Extreme': 4,
  'Severe': 3,
  'Moderate': 2,
  'Minor': 1,
  'Unknown': 0,
};

// Urgency weight mapping
const URGENCY_WEIGHTS = {
  'Immediate': 4,
  'Expected': 3,
  'Future': 2,
  'Past': 1,
  'Unknown': 0,
};

export class ImdAlertsService {
  constructor(options = {}) {
    this.rssUrl = options.rssUrl || RSS_URL;
    this.pollIntervalMs = options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;
    this.onNewAlert = typeof options.onNewAlert === 'function' ? options.onNewAlert : null;
    
    // In-memory cache keyed by alert GUID/identifier
    // Map<string, ParsedAlert>
    this.alertsMap = new Map();
    // Cache of seen item guids/links to prevent refetching known expired/past alerts
    this.seenGuids = new Set();
    this.lastFetchedAt = null;
    this.isPolling = false;
    this.timer = null;

    // Load persisted cache on startup
    this.loadCacheFromDisk();
  }

  /**
   * Load previously cached alerts from SQLite database
   */
  loadCacheFromDisk() {
    try {
      const rows = getAllAlerts();
      for (const row of rows) {
        const alert = {
          guid: row.guid,
          identifier: row.identifier,
          link: row.source_url || '',
          pubDate: row.sent || '',
          sender: row.sender,
          senderName: row.sender_name,
          sent: row.sent,
          status: row.status,
          msgType: row.msg_type,
          scope: row.scope,
          language: row.language,
          category: row.category,
          event: row.event,
          urgency: row.urgency,
          severity: row.severity,
          certainty: row.certainty,
          onset: row.onset,
          expires: row.expires,
          expiresIso: row.expires_iso,
          headline: row.headline,
          description: row.description,
          instruction: row.instruction,
          web: row.web,
          areaDesc: row.area_desc,
          polygon: row.polygon,
          source: row.source,
          sourceUrl: row.source_url,
          capParsed: !!row.cap_parsed,
          lastUpdated: row.fetched_at,
        };
        this.alertsMap.set(alert.guid, alert);
        this.seenGuids.add(alert.guid);
        if (alert.link) this.seenGuids.add(alert.link);
      }
      console.log(`[IMD Poller] Loaded ${this.alertsMap.size} active alert(s) and ${this.seenGuids.size} seen identifier(s) from SQLite.`);
    } catch (err) {
      console.warn(`[IMD Poller] Could not load cache from SQLite: ${err.message}`);
    }
  }

  /**
   * Persist in-memory alerts to SQLite database
   */
  saveCacheToDisk() {
    try {
      for (const alert of this.alertsMap.values()) {
        upsertAlert(alert);
      }
      pruneExpiredAlerts(Array.from(this.alertsMap.keys()));
    } catch (err) {
      console.warn(`[IMD Poller] Could not save cache to SQLite: ${err.message}`);
    }
  }

  /**
   * Start recurring background polling
   */
  start() {
    if (this.timer) return;
    console.log(`[IMD Poller] Starting IMD alerts background poller (interval: ${Math.round(this.pollIntervalMs / 60000)}m)...`);
    
    // Initial fetch immediately
    this.fetchAndProcess().catch((err) => {
      console.error(`[IMD Poller] Initial fetch failed:`, err);
    });

    // Scheduled interval
    this.timer = setInterval(() => {
      this.fetchAndProcess().catch((err) => {
        console.error(`[IMD Poller] Periodic fetch error:`, err);
      });
    }, this.pollIntervalMs);
  }

  /**
   * Stop background polling
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log(`[IMD Poller] Poller stopped.`);
    }
  }

  /**
   * Main fetch and processing pipeline
   */
  async fetchAndProcess() {
    if (this.isPolling) {
      console.log(`[IMD Poller] Fetch already in progress, skipping duplicate tick.`);
      return;
    }

    this.isPolling = true;
    try {
      console.log(`[IMD Poller] Fetching RSS index: ${this.rssUrl}`);
      const res = await fetch(this.rssUrl, {
        headers: {
          'User-Agent': 'WeatherGPT-SIH26068-Prototype/1.0 (Smart India Hackathon student project; contact: https://github.com/weathergpt-sih26068)',
          'Accept': 'application/rss+xml, application/xml, text/xml',
        },
        signal: AbortSignal.timeout(15000), // 15 second network timeout
      });

      if (!res.ok) {
        throw new Error(`RSS fetch HTTP ${res.status}: ${res.statusText}`);
      }

      const rssXml = await res.text();
      const rssItems = this.parseRssXml(rssXml);
      console.log(`[IMD Poller] Found ${rssItems.length} alert item(s) in RSS feed.`);

      let newCount = 0;
      let updateCount = 0;

      for (const item of rssItems) {
        const guid = item.guid || item.link;
        if (!guid || !item.link) continue;

        // Check if we already have this exact alert cached
        const existing = this.alertsMap.get(guid);
        if (existing && existing.capParsed && (existing.pubDate === item.pubDate || existing.link === item.link)) {
          // Unchanged alert, skip network fetch
          continue;
        }

        try {
          console.log(`[IMD Poller] Fetching CAP XML for: ${guid} -> ${item.link}`);
          const capAlert = await this.fetchAndParseCapXml(item.link, item);
          if (capAlert) {
            if (existing) {
              updateCount++;
            } else {
              newCount++;
            }
            this.alertsMap.set(guid, capAlert);
            // Notify listener of new/updated alert (for push dispatch)
            if (this.onNewAlert) {
              this.onNewAlert(capAlert, existing).catch((e) => {
                console.warn(`[IMD Poller] onNewAlert callback failed: ${e.message}`);
              });
            }
          }
        } catch (capErr) {
          // Log and skip individual CAP fetch failures without crashing the poller
          console.warn(`[IMD Poller] Failed to fetch/parse CAP at ${item.link}:`, capErr.message);
        }
      }

      // Cleanup expired alerts past their validity window
      const purgedCount = this.cleanupExpiredAlerts();

      this.lastFetchedAt = new Date().toISOString();
      this.saveCacheToDisk();

      console.log(`[IMD Poller] Sync complete. New: ${newCount}, Updated: ${updateCount}, Purged expired: ${purgedCount}, Active: ${this.getActiveAlerts().length}`);
    } catch (err) {
      console.error(`[IMD Poller] Polling cycle failed: ${err.message}`);
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Helper to extract tags using robust regex (safe for XML with or without namespaces)
   */
  extractXmlTag(xmlText, tagName) {
    if (!xmlText) return '';
    // Matches <tagName>val</tagName> or <prefix:tagName>val</prefix:tagName>
    const regex = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tagName}>`, 'i');
    const match = xmlText.match(regex);
    if (!match) return '';
    let val = match[1].trim();
    // Handle CDATA if wrapped
    if (val.startsWith('<![CDATA[') && val.endsWith(']]>')) {
      val = val.slice(9, -3).trim();
    }
    return val;
  }

  /**
   * Helper to extract all matching blocks
   */
  extractAllXmlBlocks(xmlText, tagName) {
    if (!xmlText) return [];
    const regex = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tagName}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tagName}>`, 'gi');
    const blocks = [];
    let match;
    while ((match = regex.exec(xmlText)) !== null) {
      blocks.push(match[1].trim());
    }
    return blocks;
  }

  /**
   * Parse RSS index XML into structured item entries
   */
  parseRssXml(rssXml) {
    const items = [];
    const itemBlocks = this.extractAllXmlBlocks(rssXml, 'item');

    for (const block of itemBlocks) {
      try {
        const title = this.extractXmlTag(block, 'title');
        let link = this.extractXmlTag(block, 'link');
        const guid = this.extractXmlTag(block, 'guid') || link;
        const pubDate = this.extractXmlTag(block, 'pubDate');
        const description = this.extractXmlTag(block, 'description');
        const category = this.extractXmlTag(block, 'category');
        const author = this.extractXmlTag(block, 'author');

        // Sanitize link if wrapped in tags or contains whitespace
        link = link.replace(/<\/?[^>]+(>|$)/g, '').trim();

        if (link) {
          items.push({
            title,
            link,
            guid,
            pubDate,
            description,
            category,
            author,
          });
        }
      } catch (e) {
        console.warn(`[IMD Poller] Malformed RSS <item> block skipped:`, e.message);
      }
    }

    return items;
  }

  /**
   * Fetches and parses a single CAP 1.2 XML alert document
   */
  async fetchAndParseCapXml(capUrl, rssMeta = {}) {
    const res = await fetch(capUrl, {
      headers: {
        'User-Agent': 'WeatherGPT-SIH26068-Prototype/1.0 (Smart India Hackathon student project; contact: https://github.com/weathergpt-sih26068)',
        'Accept': 'application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      throw new Error(`CAP fetch failed with status ${res.status}`);
    }

    const xmlText = await res.text();
    return this.parseCapDocument(xmlText, rssMeta);
  }

  /**
   * Parses the CAP 1.2 XML text into a standardized JSON alert object
   */
  parseCapDocument(xmlText, rssMeta = {}) {
    // Top-level CAP fields
    const identifier = this.extractXmlTag(xmlText, 'identifier') || rssMeta.guid || '';
    const sender = this.extractXmlTag(xmlText, 'sender') || '';
    const sent = this.extractXmlTag(xmlText, 'sent') || rssMeta.pubDate || new Date().toISOString();
    const status = this.extractXmlTag(xmlText, 'status') || 'Actual'; // Actual, Exercise, Test, Draft
    const msgType = this.extractXmlTag(xmlText, 'msgType') || 'Alert'; // Alert, Update, Cancel
    const scope = this.extractXmlTag(xmlText, 'scope') || 'Public';

    // Parse info blocks (there can be multiple info blocks, e.g. English + regional)
    const infoBlocks = this.extractAllXmlBlocks(xmlText, 'info');
    
    // Use first info block or default
    const firstInfo = infoBlocks[0] || xmlText;

    const language = this.extractXmlTag(firstInfo, 'language') || 'en';
    const category = this.extractXmlTag(firstInfo, 'category') || 'Met';
    const event = this.extractXmlTag(firstInfo, 'event') || rssMeta.title || 'Severe Weather Warning';
    const urgency = this.extractXmlTag(firstInfo, 'urgency') || 'Expected';
    const severity = this.extractXmlTag(firstInfo, 'severity') || 'Moderate';
    const certainty = this.extractXmlTag(firstInfo, 'certainty') || 'Likely';
    const onset = this.extractXmlTag(firstInfo, 'onset') || sent;
    const expires = this.extractXmlTag(firstInfo, 'expires') || '';
    const senderName = this.extractXmlTag(firstInfo, 'senderName') || 'NWFC DIVISION, IMD, NEW DELHI';
    const headline = this.extractXmlTag(firstInfo, 'headline') || rssMeta.title || event;
    const description = this.extractXmlTag(firstInfo, 'description') || rssMeta.description || '';
    const instruction = this.extractXmlTag(firstInfo, 'instruction') || '';
    const web = this.extractXmlTag(firstInfo, 'web') || 'https://mausam.imd.gov.in/';

    // Area information
    const areaBlock = this.extractXmlTag(firstInfo, 'area') || firstInfo;
    const areaDesc = this.extractXmlTag(areaBlock, 'areaDesc') || 'India / Multi-State';
    const polygon = this.extractXmlTag(areaBlock, 'polygon') || '';

    // Calculate expiry date object
    const expiresDate = expires ? new Date(expires) : null;
    const sentDate = sent ? new Date(sent) : new Date();

    const parsedAlert = {
      guid: identifier || rssMeta.guid || rssMeta.link,
      identifier,
      link: rssMeta.link || '',
      pubDate: rssMeta.pubDate || '',
      sender,
      senderName,
      sent,
      sentIso: sentDate.toISOString(),
      status,
      msgType,
      scope,
      language,
      category,
      event,
      urgency,
      severity,
      certainty,
      onset,
      expires,
      expiresIso: expiresDate ? expiresDate.toISOString() : null,
      headline: this.cleanText(headline),
      description: this.cleanText(description),
      instruction: this.cleanText(instruction),
      web,
      areaDesc: this.cleanText(areaDesc),
      polygon: polygon ? polygon.trim() : null,
      source: 'India Meteorological Department (IMD)',
      sourceUrl: rssMeta.link || web,
      capParsed: true,
      lastUpdated: new Date().toISOString(),
    };

    return parsedAlert;
  }

  /**
   * Helper to clean up formatting artifacts (tabs, multiple spaces, line breaks)
   */
  cleanText(text) {
    if (!text) return '';
    return text
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  /**
   * Purge alerts whose expiry date has passed beyond the grace window.
   * Alerts that expired within the last GRACE_PERIOD_MS are kept so the
   * UI can still display recent severe-weather context.
   */
  cleanupExpiredAlerts() {
    const now = Date.now();
    const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours
    let count = 0;

    for (const [guid, alert] of this.alertsMap.entries()) {
      if (alert.expires) {
        const expTime = new Date(alert.expires).getTime();
        if (!isNaN(expTime) && expTime < now - GRACE_PERIOD_MS) {
          this.alertsMap.delete(guid);
          count++;
        }
      }
    }

    return count;
  }

  /**
   * Get all active (non-expired and non-cancelled) alerts, sorted by severity then recency.
   * Alerts that expired within the last 24 hours are included with an `isExpired` flag
   * so the UI can still surface recent severe-weather context.
   */
  getActiveAlerts(filters = {}) {
    const now = Date.now();
    const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours
    const alerts = [];

    for (const alert of this.alertsMap.values()) {
      // Exclude cancelled alerts
      if (alert.msgType === 'Cancel') continue;

      // Determine expiry status: allow recently-expired alerts through with a flag
      let isExpired = false;
      if (alert.expires) {
        const expTime = new Date(alert.expires).getTime();
        if (!isNaN(expTime)) {
          if (expTime < now - GRACE_PERIOD_MS) continue; // Too old, skip entirely
          if (expTime < now) isExpired = true; // Recently expired, keep with flag
        }
      }

      // Filter by area / state if requested
      if (filters.area) {
        const search = filters.area.toLowerCase();
        const matchesArea = alert.areaDesc && alert.areaDesc.toLowerCase().includes(search);
        const matchesHeadline = alert.headline && alert.headline.toLowerCase().includes(search);
        if (!matchesArea && !matchesHeadline) continue;
      }

      // Filter by minimum severity if requested
      if (filters.severity) {
        const minWeight = SEVERITY_WEIGHTS[filters.severity] || 0;
        const alertWeight = SEVERITY_WEIGHTS[alert.severity] || 0;
        if (alertWeight < minWeight) continue;
      }

      alerts.push({ ...alert, isExpired });
    }

    // Sort: 1) Severity (Extreme > Severe > Moderate > Minor)
    //       2) Recency (Sent date descending)
    alerts.sort((a, b) => {
      const weightA = SEVERITY_WEIGHTS[a.severity] || 0;
      const weightB = SEVERITY_WEIGHTS[b.severity] || 0;
      if (weightB !== weightA) {
        return weightB - weightA;
      }

      const timeA = new Date(a.sent || a.onset || 0).getTime();
      const timeB = new Date(b.sent || b.onset || 0).getTime();
      return timeB - timeA;
    });

    return alerts;
  }

  /**
   * Force an immediate refresh
   */
  async refreshNow() {
    await this.fetchAndProcess();
    return this.getActiveAlerts();
  }
}
