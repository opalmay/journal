import { dateKeyFromTimestamp, timeOfDay } from "@journal/shared";
import { loadConfig } from "../config.js";
import { openDb, transaction } from "../db/index.js";
import * as repo from "../db/repo.js";
import { enqueueDaySummary } from "../ai/jobs.js";

/**
 * Re-files existing entries against the current JOURNAL_DAY_START_HOUR.
 * Changing the day boundary only affects new entries; everything written
 * before it keeps the day it was filed under. Run this once after changing
 * the setting to move the small-hours entries onto the day before, and to
 * re-summarize the days on both sides of each move.
 *
 * Prints what it would do; pass --apply to actually move anything.
 */

const apply = process.argv.includes("--apply");
const config = loadConfig();
const db = openDb(config.dbPath);

interface Row {
  id: string;
  day_date: string;
  timestamp: number;
  text: string;
}

const rows = db
  .prepare(`SELECT id, day_date, timestamp, text FROM records ORDER BY timestamp ASC`)
  .all() as unknown as Row[];

const moves = rows.flatMap((row) => {
  const dayDate = dateKeyFromTimestamp(row.timestamp, config.dayBoundary);
  return dayDate === row.day_date ? [] : [{ row, dayDate }];
});

console.log(
  `${rows.length} entries, day starts at ${String(config.JOURNAL_DAY_START_HOUR).padStart(2, "0")}:00 ` +
    `(${config.JOURNAL_TZ}), ${moves.length} to move.`,
);
for (const { row, dayDate } of moves) {
  const when = timeOfDay(row.timestamp, config.JOURNAL_TZ);
  const snippet = row.text.replace(/\s+/g, " ").trim().slice(0, 48) || "(no text)";
  console.log(`  ${row.day_date} ${when} → ${dayDate}  ${snippet}`);
}

if (moves.length > 0 && !apply) {
  console.log("\nNothing changed. Re-run with --apply to move them.");
} else if (moves.length > 0) {
  const touched = new Set<string>();
  transaction(db, () => {
    const update = db.prepare(`UPDATE records SET day_date = ?, updated_at = ? WHERE id = ?`);
    const now = Date.now();
    for (const { row, dayDate } of moves) {
      repo.ensureDay(db, dayDate, now);
      update.run(dayDate, now, row.id);
      touched.add(row.day_date).add(dayDate);
    }
    for (const date of touched) repo.pruneEmptyDay(db, date);
    // The days on both sides changed, so their summaries and extracted
    // metrics are stale — anything the author set by hand is kept.
    for (const date of touched) if (repo.getDay(db, date)) enqueueDaySummary(db, date, 0);
  });
  console.log(`\nMoved ${moves.length} entries; queued ${touched.size} days to re-summarize.`);
}

db.close();
