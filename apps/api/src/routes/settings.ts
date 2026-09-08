import type { FastifyInstance } from "fastify";
import * as repo from "../db/repo.js";
import { jobStats } from "../ai/jobs.js";

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings", async () => {
    const { config, db } = app;
    return {
      timeZone: config.JOURNAL_TZ,
      aiEnabled: Boolean(app.worker),
      aiModels: { title: config.AI_TITLE_MODEL, day: config.AI_DAY_MODEL },
      maxUploadBytes: config.MAX_UPLOAD_BYTES,
      webhookPath: "/api/webhooks/ring",
      // The token is a secret the user already holds; showing it here saves a
      // trip to the server's .env when configuring the ring.
      webhookTokenSet: Boolean(config.WEBHOOK_TOKEN),
      storage: repo.storageUsage(db),
      jobs: jobStats(db),
    };
  });
}
