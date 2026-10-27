-- Dimensions of a day beyond mood. Each is nullable: most days only some get
-- mentioned. Values are either typed by the user or extracted by the day
-- summary job from what they said. `user_fields` lists the ones the user
-- has set or cleared by hand, which the job never touches (src/db/repo.ts).
ALTER TABLE days ADD COLUMN energy INTEGER CHECK (energy IS NULL OR (energy BETWEEN 1 AND 5));
ALTER TABLE days ADD COLUMN sleep_hours REAL CHECK (sleep_hours IS NULL OR (sleep_hours BETWEEN 0 AND 24));
ALTER TABLE days ADD COLUMN sleep_quality TEXT CHECK (sleep_quality IS NULL OR sleep_quality IN ('poor', 'ok', 'good'));
ALTER TABLE days ADD COLUMN appetite TEXT CHECK (appetite IS NULL OR appetite IN ('low', 'normal', 'high'));
ALTER TABLE days ADD COLUMN social TEXT CHECK (social IS NULL OR social IN ('none', 'some', 'a_lot'));
ALTER TABLE days ADD COLUMN cycle_day INTEGER CHECK (cycle_day IS NULL OR (cycle_day BETWEEN 1 AND 60));
ALTER TABLE days ADD COLUMN caffeine INTEGER CHECK (caffeine IS NULL OR (caffeine BETWEEN 0 AND 50));
ALTER TABLE days ADD COLUMN alcohol INTEGER CHECK (alcohol IS NULL OR (alcohol BETWEEN 0 AND 50));
ALTER TABLE days ADD COLUMN exercise TEXT;
ALTER TABLE days ADD COLUMN intake TEXT;
ALTER TABLE days ADD COLUMN user_fields TEXT NOT NULL DEFAULT '[]';  -- JSON array of field names
ALTER TABLE days ADD COLUMN metrics_extracted_at INTEGER;

-- Every mood so far was picked by hand.
UPDATE days SET user_fields = '["mood"]' WHERE mood IS NOT NULL;

-- A single row of journal-wide preferences, created on first read like
-- reminder_settings.
CREATE TABLE preferences (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  track_cycle INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);
