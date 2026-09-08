import type { FastifyInstance } from "fastify";
import { DateKeySchema, DayRangeQuery, UpdateDayInput, addDays } from "@journal/shared";
import * as repo from "../db/repo.js";
import { enqueueDaySummary } from "../ai/jobs.js";

export async function registerDayRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app;

  app.get("/api/days", async (request) => {
    const raw = request.query as Record<string, string | undefined>;
    // Default to the last 90 days so the calendar and timeline have something.
    const today = new Date().toISOString().slice(0, 10);
    const query = DayRangeQuery.parse({
      from: raw.from ?? addDays(today, -90),
      to: raw.to ?? today,
    });
    return { days: repo.listDays(db, query.from, query.to) };
  });

  app.get("/api/days/:date", async (request, reply) => {
    const date = DateKeySchema.parse((request.params as { date: string }).date);
    const day = repo.getDayDetail(db, date);
    if (!day) {
      // An untouched day is a valid, empty day rather than a 404.
      return {
        date,
        title: null,
        summary: null,
        note: null,
        mood: null,
        tags: [],
        recordCount: 0,
        records: [],
        createdAt: 0,
        updatedAt: 0,
      };
    }
    return reply.send(day);
  });

  app.patch("/api/days/:date", async (request, reply) => {
    const date = DateKeySchema.parse((request.params as { date: string }).date);
    const patch = UpdateDayInput.parse(request.body);
    const day = repo.updateDay(db, date, patch);
    if (!day) return reply.code(404).send({ error: "not_found" });
    return day;
  });

  app.post("/api/days/:date/regenerate", async (request, reply) => {
    const date = DateKeySchema.parse((request.params as { date: string }).date);
    if (!config.aiEnabled && !app.worker) {
      return reply.code(503).send({ error: "ai_disabled" });
    }
    enqueueDaySummary(db, date, 0);
    void app.worker?.tick();
    return { queued: true };
  });
}
