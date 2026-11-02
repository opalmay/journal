-- Naps follow the night: the two times a nap ran between, with its length
-- worked out from the pair (src/db/repo.ts), instead of a length and a free
-- text range that said the same thing twice.
ALTER TABLE days ADD COLUMN nap_start TEXT;
ALTER TABLE days ADD COLUMN nap_end TEXT;

-- Carry over the first range of every nap_times that reads as one, whatever
-- dash it used: "13:00–14:30" becomes 13:00 and 14:30.
UPDATE days
   SET nap_start = substr(nap_times, 1, 5),
       nap_end   = substr(nap_times, 7, 5)
 WHERE nap_times IS NOT NULL
   AND substr(nap_times, 1, 5) GLOB '[0-2][0-9]:[0-5][0-9]'
   AND substr(nap_times, 7, 5) GLOB '[0-2][0-9]:[0-5][0-9]';

ALTER TABLE days DROP COLUMN nap_times;
