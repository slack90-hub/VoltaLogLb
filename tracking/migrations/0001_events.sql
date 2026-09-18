CREATE TABLE IF NOT EXISTS gallery_sessions (
  id TEXT PRIMARY KEY,
  key_at TEXT,
  opened_at TEXT
);
CREATE TABLE IF NOT EXISTS tracking_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO tracking_metadata (id) VALUES (1);
