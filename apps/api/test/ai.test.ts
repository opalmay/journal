import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeContext, type TestContext } from "./helpers.js";
import { AiWorker } from "../src/ai/worker.js";
import {
  DAY_SUMMARY_DEBOUNCE_MS,
  claimNextJob,
  enqueueDaySummary,
  enqueueRecordTitle,
} from "../src/ai/jobs.js";

const silent = { info() {}, error() {} };

describe("ai worker", () => {
  let ctx: TestContext;
  let worker: AiWorker;
  const auth = () => ({ cookie: ctx.cookie });

  beforeEach(async () => {
    ctx = await makeContext();
    worker = new AiWorker(ctx.app.db, ctx.app.config, ctx.summarizer, silent);
  });
  afterEach(async () => {
    await ctx.close();
  });

  const addRecord = (text: string, timestamp: number) =>
    ctx.app
      .inject({ method: "POST", url: "/api/records", headers: auth(), payload: { text, timestamp } })
      .then((r) => r.json());

  it("titles a record and summarizes its day", async () => {
    const record = await addRecord("cycled to the lake", Date.parse("2026-09-08T10:00:00Z"));
    // The day job is debounced into the future; run it now.
    enqueueDaySummary(ctx.app.db, record.dayDate, 0);

    const handled = await worker.tick();
    expect(handled).toBe(2);

    const day = await ctx.app
      .inject({ method: "GET", url: `/api/days/${record.dayDate}`, headers: auth() })
      .then((r) => r.json());
    expect(day.title).toBe("a day");
    expect(day.summary).toBe("things happened");
    expect(day.tags).toContain("generated");
    expect(day.records[0].title).toBe("title for cycled to the lake");
  });

  it("keeps tags the user added when the summary suggests its own", async () => {
    const record = await addRecord("gardening", Date.parse("2026-09-08T10:00:00Z"));
    await ctx.app.inject({
      method: "PATCH",
      url: `/api/days/${record.dayDate}`,
      headers: auth(),
      payload: { tags: ["mine"] },
    });
    enqueueDaySummary(ctx.app.db, record.dayDate, 0);
    await worker.tick();

    const day = await ctx.app
      .inject({ method: "GET", url: `/api/days/${record.dayDate}`, headers: auth() })
      .then((r) => r.json());
    expect(day.tags).toEqual(["generated", "mine"]);
  });

  it("debounces a burst of records into one day job", async () => {
    for (let i = 0; i < 4; i++) {
      await addRecord(`burst ${i}`, Date.parse("2026-09-08T10:00:00Z") + i * 1000);
    }
    const dayJobs = ctx.app.db
      .prepare("SELECT run_after FROM ai_jobs WHERE kind = 'day_summary'")
      .all() as unknown as { run_after: number }[];
    expect(dayJobs).toHaveLength(1);
    // The single job sits at the end of the debounce window, not the start.
    expect(dayJobs[0]!.run_after).toBeGreaterThan(Date.now() + DAY_SUMMARY_DEBOUNCE_MS - 5_000);
  });

  it("does not claim a job before its run_after", async () => {
    const record = await addRecord("later", Date.parse("2026-09-08T10:00:00Z"));
    ctx.app.db.prepare("DELETE FROM ai_jobs WHERE kind = 'record_title'").run();
    enqueueDaySummary(ctx.app.db, record.dayDate);
    expect(claimNextJob(ctx.app.db)).toBeNull();
    expect(claimNextJob(ctx.app.db, Date.now() + DAY_SUMMARY_DEBOUNCE_MS + 1)).not.toBeNull();
  });

  it("retries a failing job with backoff, then gives up", async () => {
    const record = await addRecord("boom", Date.parse("2026-09-08T10:00:00Z"));
    ctx.app.db.prepare("DELETE FROM ai_jobs").run();
    const failing = {
      async recordTitle(): Promise<{ title: string }> {
        throw new Error("model unavailable");
      },
      async daySummary(): Promise<never> {
        throw new Error("unused");
      },
    };
    const failingWorker = new AiWorker(ctx.app.db, ctx.app.config, failing, silent);

    enqueueRecordTitle(ctx.app.db, record.id);
    for (let attempt = 1; attempt <= 5; attempt++) {
      await failingWorker.tick();
      const job = ctx.app.db.prepare("SELECT * FROM ai_jobs").get() as unknown as {
        status: string;
        attempts: number;
        last_error: string;
      };
      expect(job.attempts).toBe(attempt);
      expect(job.last_error).toBe("model unavailable");
      expect(job.status).toBe(attempt === 5 ? "failed" : "pending");
      // Let the next tick see the job despite its backoff.
      ctx.app.db.prepare("UPDATE ai_jobs SET run_after = 0 WHERE status = 'pending'").run();
    }
  });

  it("skips a record deleted before its title was written", async () => {
    const record = await addRecord("fleeting", Date.parse("2026-09-08T10:00:00Z"));
    await ctx.app.inject({
      method: "DELETE",
      url: `/api/records/${record.id}`,
      headers: auth(),
    });
    ctx.app.db.prepare("UPDATE ai_jobs SET run_after = 0").run();
    await expect(worker.tick()).resolves.toBeGreaterThan(0);
    const failed = ctx.app.db
      .prepare("SELECT COUNT(*) AS n FROM ai_jobs WHERE status = 'failed'")
      .get() as unknown as { n: number };
    expect(failed.n).toBe(0);
  });
});
