-- When the night started and ended, as 24-hour HH:MM, so a night is entered as
-- the two times it ran between rather than as hours worked out by hand. Hours
-- slept is derived from the pair whenever both are known (src/db/repo.ts);
-- sleep_hours stays the figure for nights given only as a length.
ALTER TABLE days ADD COLUMN sleep_start TEXT;
ALTER TABLE days ADD COLUMN sleep_end TEXT;
