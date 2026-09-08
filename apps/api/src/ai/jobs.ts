import type { Db } from "../db/index.js";
import { randomUUID } from "../ids.js";

export type JobKind = "record_title" | "day_summary";

export interface JobRow {
  id: string;
  kind: JobKind;
  target_id: string;
  status: "pending" | "running" | "done" | "failed";
  run_after: number;
  attempts: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export const MAX_ATTEMPTS = 5;
/** Records keep arriving in bursts; wait this long before summarizing a day. */
export const DAY_SUMMARY_DEBOUNCE_MS = 5 * 60_000;

/**
 * Queues a job, coalescing with any job already live for the same target.
 * A conflicting job that is mid-flight is pushed back to `pending`, which the
 * worker's conditional completion update respects — so the newer data wins.
 */
export function enqueue(db: Db, kind: JobKind, targetId: string, delayMs = 0): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO ai_jobs (id, kind, target_id, status, run_after, attempts, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, 0, ?, ?)
     ON CONFLICT (kind, target_id) WHERE status IN ('pending', 'running')
     DO UPDATE SET run_after = excluded.run_after, status = 'pending', updated_at = excluded.updated_at`,
  ).run(randomUUID(), kind, targetId, now + delayMs, now, now);
}

export function enqueueRecordTitle(db: Db, recordId: string): void {
  enqueue(db, "record_title", recordId);
}

export function enqueueDaySummary(db: Db, date: string, delayMs = DAY_SUMMARY_DEBOUNCE_MS): void {
  enqueue(db, "day_summary", date, delayMs);
}

export function claimNextJob(db: Db, now = Date.now()): JobRow | null {
  const row = db
    .prepare(
      `UPDATE ai_jobs
          SET status = 'running', attempts = attempts + 1, updated_at = ?
        WHERE id = (
          SELECT id FROM ai_jobs
           WHERE status = 'pending' AND run_after <= ?
           ORDER BY run_after ASC, created_at ASC
           LIMIT 1)
        RETURNING *`,
    )
    .get(now, now) as unknown as JobRow | undefined;
  return row ?? null;
}

/**
 * Marks a claimed job finished. Guarded on `status = 'running'` so a re-queue
 * that landed while the job was in flight is not overwritten.
 */
export function completeJob(db: Db, id: string): void {
  db.prepare(`UPDATE ai_jobs SET status = 'done', updated_at = ? WHERE id = ? AND status = 'running'`)
    .run(Date.now(), id);
}

export function failJob(db: Db, job: JobRow, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const now = Date.now();
  if (job.attempts >= MAX_ATTEMPTS) {
    db.prepare(
      `UPDATE ai_jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ? AND status = 'running'`,
    ).run(message.slice(0, 2000), now, job.id);
    return;
  }
  const backoff = Math.min(2 ** job.attempts * 5_000, 10 * 60_000);
  db.prepare(
    `UPDATE ai_jobs SET status = 'pending', run_after = ?, last_error = ?, updated_at = ?
      WHERE id = ? AND status = 'running'`,
  ).run(now + backoff, message.slice(0, 2000), now, job.id);
}

/** Jobs left `running` by a crash are reclaimed on the next boot. */
export function requeueStaleJobs(db: Db): void {
  db.prepare(`UPDATE ai_jobs SET status = 'pending', updated_at = ? WHERE status = 'running'`).run(
    Date.now(),
  );
}

export function jobStats(db: Db): Record<string, number> {
  const rows = db
    .prepare(`SELECT status, COUNT(*) AS n FROM ai_jobs GROUP BY status`)
    .all() as unknown as { status: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
