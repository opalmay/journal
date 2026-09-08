CREATE TABLE days (
  date            TEXT PRIMARY KEY,          -- YYYY-MM-DD in JOURNAL_TZ
  title           TEXT,
  summary         TEXT,
  note            TEXT,
  mood            INTEGER CHECK (mood IS NULL OR (mood BETWEEN 1 AND 5)),
  ai_generated_at INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE records (
  id              TEXT PRIMARY KEY,
  day_date        TEXT NOT NULL REFERENCES days(date) ON DELETE CASCADE,
  timestamp       INTEGER NOT NULL,
  text            TEXT NOT NULL DEFAULT '',
  title           TEXT,
  source          TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'ring', 'api')),
  client_name     TEXT,
  dedupe_key      TEXT UNIQUE,
  ai_generated_at INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX records_day_idx ON records (day_date, timestamp);
CREATE INDEX records_ts_idx ON records (timestamp DESC);

CREATE TABLE media (
  id            TEXT PRIMARY KEY,
  record_id     TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('audio', 'image', 'video', 'file')),
  rel_path      TEXT NOT NULL,
  mime_type     TEXT NOT NULL,
  original_name TEXT,
  size_bytes    INTEGER NOT NULL,
  duration_ms   INTEGER,
  created_at    INTEGER NOT NULL
);
CREATE INDEX media_record_idx ON media (record_id);

CREATE TABLE tags (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE record_tags (
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  tag_id    TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (record_id, tag_id)
);
CREATE INDEX record_tags_tag_idx ON record_tags (tag_id);

CREATE TABLE day_tags (
  day_date TEXT NOT NULL REFERENCES days(date) ON DELETE CASCADE,
  tag_id   TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (day_date, tag_id)
);
CREATE INDEX day_tags_tag_idx ON day_tags (tag_id);

CREATE TABLE ai_jobs (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('record_title', 'day_summary')),
  target_id  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending', 'running', 'done', 'failed')),
  run_after  INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- At most one live job per target, so re-queuing coalesces instead of piling up.
CREATE UNIQUE INDEX ai_jobs_live_idx ON ai_jobs (kind, target_id)
  WHERE status IN ('pending', 'running');
CREATE INDEX ai_jobs_claim_idx ON ai_jobs (status, run_after);

-- Full-text search over record text and title. `content=''` keeps the index
-- standalone (contentless tables cannot be UPDATEd, so the triggers below
-- delete-then-insert on every change).
CREATE VIRTUAL TABLE records_fts USING fts5(text, title, tokenize = 'unicode61');

CREATE TRIGGER records_fts_ai AFTER INSERT ON records BEGIN
  INSERT INTO records_fts (rowid, text, title)
  VALUES (new.rowid, new.text, coalesce(new.title, ''));
END;
CREATE TRIGGER records_fts_ad AFTER DELETE ON records BEGIN
  DELETE FROM records_fts WHERE rowid = old.rowid;
END;
CREATE TRIGGER records_fts_au AFTER UPDATE ON records BEGIN
  DELETE FROM records_fts WHERE rowid = old.rowid;
  INSERT INTO records_fts (rowid, text, title)
  VALUES (new.rowid, new.text, coalesce(new.title, ''));
END;

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
