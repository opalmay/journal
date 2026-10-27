import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeContext, type TestContext } from "./helpers.js";
import { AiWorker } from "../src/ai/worker.js";
import { enqueueDaySummary } from "../src/ai/jobs.js";

const silent = { info() {}, error() {} };
const DATE = "2026-09-08";
const NOON = Date.parse("2026-09-08T10:00:00Z");

describe("day metrics", () => {
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

  const addRecord = (text: string, timestamp = NOON) =>
    ctx.app
      .inject({ method: "POST", url: "/api/records", headers: auth(), payload: { text, timestamp } })
      .then((r) => r.json());
  const getDay = (date = DATE) =>
    ctx.app.inject({ method: "GET", url: `/api/days/${date}`, headers: auth() }).then((r) => r.json());
  const patchDay = (payload: Record<string, unknown>, date = DATE) =>
    ctx.app.inject({ method: "PATCH", url: `/api/days/${date}`, headers: auth(), payload });
  const summarize = async (date = DATE) => {
    enqueueDaySummary(ctx.app.db, date, 0);
    await worker.tick();
  };

  it("fills fields from the entries and flags the ones it could not find", async () => {
    await addRecord("mood 4, energy high, slept badly");
    ctx.summarizer.metrics = { mood: 4, energy: 4, sleepQuality: "poor" };
    await summarize();

    const day = await getDay();
    expect(day.mood).toBe(4);
    expect(day.metrics).toMatchObject({ energy: 4, sleepQuality: "poor", appetite: null });
    expect(day.aiFields.sort()).toEqual(["energy", "mood", "sleepQuality"]);
    expect(day.metricsMissing).toContain("appetite");
    expect(day.metricsMissing).not.toContain("energy");
  });

  it("never overwrites a value the user set or cleared", async () => {
    await addRecord("energy high");
    expect((await patchDay({ mood: 2, metrics: { energy: 1, appetite: null } })).statusCode).toBe(200);
    ctx.summarizer.metrics = { mood: 5, energy: 5, appetite: "high", social: "some" };
    await summarize();

    const day = await getDay();
    expect(day.mood).toBe(2);
    expect(day.metrics).toMatchObject({ energy: 1, appetite: null, social: "some" });
    expect(day.aiFields).toEqual(["social"]);
    expect(day.metricsMissing).not.toContain("appetite");

    const input = ctx.summarizer.dayCalls.at(-1)!;
    expect(input.extract).not.toContain("energy");
    expect(input.extract).not.toContain("appetite");
    expect(input.userMetrics).toEqual({ mood: 2, energy: 1 });
    expect(input.mood).toBe(2);
  });

  it("drops an AI value once nothing supports it", async () => {
    await addRecord("two coffees");
    const other = await addRecord("quiet evening", NOON + 60_000);
    ctx.summarizer.metrics = { caffeine: 2 };
    await summarize();
    expect((await getDay()).metrics.caffeine).toBe(2);

    await ctx.app.inject({ method: "DELETE", url: `/api/records/${other.id}`, headers: auth() });
    ctx.summarizer.metrics = {};
    await summarize();
    const day = await getDay();
    expect(day.metrics.caffeine).toBeNull();
    expect(day.metricsMissing).toContain("caffeine");
  });

  it("only asks about the cycle when tracking is on, and counts it forward", async () => {
    await addRecord("period started today");
    ctx.summarizer.metrics = { cycleDay: 1 };
    await summarize();
    expect(ctx.summarizer.dayCalls.at(-1)!.extract).not.toContain("cycleDay");
    expect((await getDay()).metrics.cycleDay).toBeNull();

    const settings = await ctx.app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: auth(),
      payload: { trackCycle: true },
    });
    expect(settings.json()).toEqual({ trackCycle: true });
    await summarize();
    expect(ctx.summarizer.dayCalls.at(-1)!.extract).toContain("cycleDay");
    expect((await getDay()).metrics.cycleDay).toBe(1);

    await addRecord("later", Date.parse("2026-09-21T10:00:00Z"));
    ctx.summarizer.metrics = {};
    await summarize("2026-09-21");
    const later = await getDay("2026-09-21");
    expect(later.metrics.cycleDay).toBe(14);
    expect(later.cycleDayDerived).toBe(true);
    expect(later.metricsMissing).not.toContain("cycleDay");
  });

  it("rejects values outside the scales", async () => {
    await addRecord("x");
    expect((await patchDay({ metrics: { energy: 6 } })).statusCode).toBe(400);
    expect((await patchDay({ metrics: { social: "loads" } })).statusCode).toBe(400);
    expect((await patchDay({ metrics: { sleepHours: 7.5, social: "a_lot" } })).statusCode).toBe(200);
  });
});
