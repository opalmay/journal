-- Broken nights and naps, kept apart from the night's total, plus which
-- entries each AI-extracted value came from: a JSON object mapping a field
-- name to the ids of the records that mention it.
ALTER TABLE days ADD COLUMN sleep_wakings INTEGER CHECK (sleep_wakings IS NULL OR (sleep_wakings BETWEEN 0 AND 20));
ALTER TABLE days ADD COLUMN nap_hours REAL CHECK (nap_hours IS NULL OR (nap_hours BETWEEN 0 AND 24));
ALTER TABLE days ADD COLUMN metric_sources TEXT NOT NULL DEFAULT '{}';
