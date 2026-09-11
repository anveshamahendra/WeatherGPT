import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.resolve(__dirname, '../data/weathergpt.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS imd_alerts (
    guid TEXT PRIMARY KEY,
    identifier TEXT,
    sender TEXT,
    sender_name TEXT,
    sent TEXT,
    status TEXT,
    msg_type TEXT,
    scope TEXT,
    language TEXT,
    category TEXT,
    event TEXT,
    urgency TEXT,
    severity TEXT,
    certainty TEXT,
    onset TEXT,
    expires TEXT,
    expires_iso TEXT,
    headline TEXT,
    description TEXT,
    instruction TEXT,
    web TEXT,
    area_desc TEXT,
    polygon TEXT,
    source TEXT,
    source_url TEXT,
    cap_parsed INTEGER,
    fetched_at TEXT
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    subscription_json TEXT NOT NULL,
    location_name TEXT,
    latitude REAL,
    longitude REAL,
    min_severity TEXT,
    created_at TEXT
  );
`);

// --- IMD Alerts ---

const stmtGetAllAlerts = db.prepare('SELECT * FROM imd_alerts');

const stmtUpsertAlert = db.prepare(`
  INSERT INTO imd_alerts (
    guid, identifier, sender, sender_name, sent, status, msg_type, scope,
    language, category, event, urgency, severity, certainty, onset, expires,
    expires_iso, headline, description, instruction, web, area_desc, polygon,
    source, source_url, cap_parsed, fetched_at
  ) VALUES (
    @guid, @identifier, @sender, @senderName, @sent, @status, @msgType, @scope,
    @language, @category, @event, @urgency, @severity, @certainty, @onset, @expires,
    @expiresIso, @headline, @description, @instruction, @web, @areaDesc, @polygon,
    @source, @sourceUrl, @capParsed, @fetchedAt
  )
  ON CONFLICT(guid) DO UPDATE SET
    identifier=excluded.identifier, sender=excluded.sender, sender_name=excluded.sender_name,
    sent=excluded.sent, status=excluded.status, msg_type=excluded.msg_type, scope=excluded.scope,
    language=excluded.language, category=excluded.category, event=excluded.event,
    urgency=excluded.urgency, severity=excluded.severity, certainty=excluded.certainty,
    onset=excluded.onset, expires=excluded.expires, expires_iso=excluded.expires_iso,
    headline=excluded.headline, description=excluded.description, instruction=excluded.instruction,
    web=excluded.web, area_desc=excluded.area_desc, polygon=excluded.polygon,
    source=excluded.source, source_url=excluded.source_url, cap_parsed=excluded.cap_parsed,
    fetched_at=excluded.fetched_at
`);

const stmtDeleteAlert = db.prepare('DELETE FROM imd_alerts WHERE guid = ?');

const stmtDeleteAlertsByGuids = db.prepare(`
  DELETE FROM imd_alerts WHERE guid NOT IN (SELECT value FROM json_each(?))
`);

function getAllAlerts() {
  return stmtGetAllAlerts.all();
}

function upsertAlert(alert) {
  stmtUpsertAlert.run({
    guid: alert.guid,
    identifier: alert.identifier || '',
    sender: alert.sender || '',
    senderName: alert.senderName || '',
    sent: alert.sent || '',
    status: alert.status || '',
    msgType: alert.msgType || '',
    scope: alert.scope || '',
    language: alert.language || '',
    category: alert.category || '',
    event: alert.event || '',
    urgency: alert.urgency || '',
    severity: alert.severity || '',
    certainty: alert.certainty || '',
    onset: alert.onset || '',
    expires: alert.expires || '',
    expiresIso: alert.expiresIso || '',
    headline: alert.headline || '',
    description: alert.description || '',
    instruction: alert.instruction || '',
    web: alert.web || '',
    areaDesc: alert.areaDesc || '',
    polygon: alert.polygon || '',
    source: alert.source || '',
    sourceUrl: alert.sourceUrl || '',
    capParsed: alert.capParsed ? 1 : 0,
    fetchedAt: alert.lastUpdated || new Date().toISOString(),
  });
}

function pruneExpiredAlerts(remainingGuids) {
  if (!remainingGuids.length) {
    db.exec('DELETE FROM imd_alerts');
    return;
  }
  const guidJson = JSON.stringify(remainingGuids);
  stmtDeleteAlertsByGuids.run(guidJson);
}

// --- Push Subscriptions ---

const stmtGetAllSubscriptions = db.prepare('SELECT * FROM push_subscriptions');

const stmtUpsertSubscription = db.prepare(`
  INSERT INTO push_subscriptions (endpoint, subscription_json, location_name, latitude, longitude, min_severity, created_at)
  VALUES (@endpoint, @subscriptionJson, @locationName, @latitude, @longitude, @minSeverity, @createdAt)
  ON CONFLICT(endpoint) DO UPDATE SET
    subscription_json=excluded.subscription_json, location_name=excluded.location_name,
    latitude=excluded.latitude, longitude=excluded.longitude, min_severity=excluded.min_severity
`);

const stmtDeleteSubscription = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');

function getAllSubscriptions() {
  return stmtGetAllSubscriptions.all();
}

function upsertSubscription(sub) {
  const loc = sub.location || {};
  stmtUpsertSubscription.run({
    endpoint: sub.subscription.endpoint,
    subscriptionJson: JSON.stringify(sub.subscription),
    locationName: loc.name || null,
    latitude: loc.latitude ?? null,
    longitude: loc.longitude ?? null,
    minSeverity: sub.minSeverity || 'Severe',
    createdAt: sub.subscribedAt || new Date().toISOString(),
  });
}

function deleteSubscription(endpoint) {
  return stmtDeleteSubscription.run(endpoint).changes > 0;
}

export {
  db,
  getAllAlerts,
  upsertAlert,
  pruneExpiredAlerts,
  getAllSubscriptions,
  upsertSubscription,
  deleteSubscription,
};
