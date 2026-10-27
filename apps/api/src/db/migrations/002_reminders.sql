-- A single row: the journal has one owner and one daily reminder. The row is
-- created on first read (src/reminders/reminders.ts) so the topic comes from
-- node:crypto rather than SQLite's randomblob().
CREATE TABLE reminder_settings (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  ntfy_topic    TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 0,
  time          TEXT NOT NULL DEFAULT '21:00',  -- HH:mm in JOURNAL_TZ
  app_url       TEXT,                           -- where a tapped notification opens
  done_for_date TEXT,                           -- day the reminder last fired or was skipped
  updated_at    INTEGER NOT NULL
);
