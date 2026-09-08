import type { Db } from "../db/index.js";
import type { Config } from "../config.js";
import type { Summarizer } from "./client.js";
import { claimNextJob, completeJob, failJob, requeueStaleJobs, type JobRow } from "./jobs.js";
import * as repo from "../db/repo.js";
import { timeOfDay } from "@journal/shared";

const POLL_INTERVAL_MS = 2_000;

export interface WorkerLogger {
  info(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export class AiWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly summarizer: Summarizer,
    private readonly log: WorkerLogger,
  ) {}

  start(): void {
    if (this.timer) return;
    requeueStaleJobs(this.db);
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
    // Never hold the process open just to poll an empty queue.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Drains the queue. Exposed so tests and `/regenerate` can run it directly. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let handled = 0;
    try {
      for (;;) {
        const job = claimNextJob(this.db);
        if (!job) break;
        await this.run(job);
        handled++;
      }
    } finally {
      this.running = false;
    }
    return handled;
  }

  private async run(job: JobRow): Promise<void> {
    try {
      if (job.kind === "record_title") await this.runRecordTitle(job);
      else await this.runDaySummary(job);
      completeJob(this.db, job.id);
    } catch (err) {
      this.log.error({ err, job: job.id, kind: job.kind }, "ai job failed");
      failJob(this.db, job, err);
    }
  }

  private async runRecordTitle(job: JobRow): Promise<void> {
    const record = repo.getRecord(this.db, job.target_id);
    // A record deleted before its title was written is not an error.
    if (!record || !record.text.trim()) return;
    const { title } = await this.summarizer.recordTitle(record.text);
    repo.setRecordTitle(this.db, record.id, title.trim());
  }

  private async runDaySummary(job: JobRow): Promise<void> {
    const day = repo.getDay(this.db, job.target_id);
    if (!day) return;
    const records = repo.listRecordsForDay(this.db, job.target_id);
    if (records.length === 0) return;

    const lines = records.map((r) => {
      const time = timeOfDay(r.timestamp, this.config.JOURNAL_TZ);
      const tags = r.tags.length ? ` [${r.tags.join(", ")}]` : "";
      const body = r.text.trim() || `(${r.media.map((m) => m.kind).join(", ") || "empty entry"})`;
      return `${time} — ${body}${tags}`;
    });

    const result = await this.summarizer.daySummary({
      date: day.date,
      mood: day.mood,
      lines,
      existingTags: day.tags,
    });
    repo.setDaySummary(this.db, day.date, {
      title: result.title.trim(),
      summary: result.summary.trim(),
      tags: result.tags,
    });
  }
}
