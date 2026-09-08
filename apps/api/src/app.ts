import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Config } from "./config.js";
import { openDb, type Db } from "./db/index.js";
import { AiWorker } from "./ai/worker.js";
import { ClaudeSummarizer, type Summarizer } from "./ai/client.js";
import { isSessionValid, purgeExpiredSessions, SESSION_COOKIE } from "./auth.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerDayRoutes } from "./routes/days.js";
import { registerRecordRoutes } from "./routes/records.js";
import { registerMediaRoutes } from "./routes/media.js";
import { registerTagRoutes } from "./routes/tags.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { registerSettingsRoutes } from "./routes/settings.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    config: Config;
    worker: AiWorker | null;
  }
  interface FastifyRequest {
    sessionId: string | null;
  }
}

export interface BuildOptions {
  /** Overrides the real Claude client — used by tests. */
  summarizer?: Summarizer;
  logger?: boolean;
}

/** Routes reachable without a session cookie. */
const PUBLIC_PATHS = new Set(["/api/auth/login", "/api/auth/me", "/api/health"]);

export async function buildApp(config: Config, options: BuildOptions = {}): Promise<FastifyInstance> {
  fs.mkdirSync(config.mediaDir, { recursive: true });
  const db = openDb(config.dbPath);
  purgeExpiredSessions(db);

  const app = Fastify({
    logger: options.logger ?? config.NODE_ENV !== "test",
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });

  app.decorate("db", db);
  app.decorate("config", config);
  app.decorate("worker", null as AiWorker | null);
  app.decorateRequest("sessionId", null);

  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(multipart, {
    limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 10, fields: 20 },
  });
  await app.register(rateLimit, {
    global: false,
    max: 30,
    timeWindow: "1 minute",
  });

  const summarizer: Summarizer | null = options.summarizer
    ? options.summarizer
    : config.aiEnabled
      ? new ClaudeSummarizer({
          apiKey: config.ANTHROPIC_API_KEY,
          titleModel: config.AI_TITLE_MODEL,
          dayModel: config.AI_DAY_MODEL,
        })
      : null;

  if (summarizer) {
    const worker = new AiWorker(db, config, summarizer, app.log);
    app.worker = worker;
    app.addHook("onReady", async () => worker.start());
    app.addHook("onClose", async () => worker.stop());
  }

  app.addHook("onClose", async () => db.close());

  // --- session gate ------------------------------------------------------
  app.addHook("onRequest", async (request, reply) => {
    const url = request.url.split("?")[0] ?? "";
    if (!url.startsWith("/api/")) return;
    if (PUBLIC_PATHS.has(url) || url.startsWith("/api/webhooks/")) return;

    const raw = request.cookies[SESSION_COOKIE];
    const unsigned = raw ? request.unsignCookie(raw) : null;
    const id = unsigned?.valid ? unsigned.value : null;
    if (!id || !isSessionValid(db, id)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    request.sessionId = id;
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: "invalid_request", issues: error.issues });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status < 500) {
      return reply.code(status).send({ error: (error as Error).message });
    }
    request.log.error({ err: error }, "unhandled error");
    return reply.code(500).send({ error: "internal_error" });
  });

  app.get("/api/health", async () => ({ ok: true }));

  await registerAuthRoutes(app);
  await registerDayRoutes(app);
  await registerRecordRoutes(app);
  await registerMediaRoutes(app);
  await registerTagRoutes(app);
  await registerWebhookRoutes(app);
  await registerSettingsRoutes(app);
  await registerWebApp(app);

  return app;
}

/**
 * Serves the built web app in production, with a catch-all so client-side
 * routes like `/day/2026-09-08` survive a page reload. Skipped entirely when
 * the bundle has not been built — in dev, Vite serves it and proxies here.
 */
async function registerWebApp(app: FastifyInstance): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../web/dist"),
    path.resolve(here, "../../../web/dist"),
  ];
  const root = candidates.find((dir) => fs.existsSync(path.join(dir, "index.html")));
  if (!root) return;

  await app.register(fastifyStatic, { root, wildcard: false });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "not_found" });
    return reply.sendFile("index.html");
  });
}
