import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { RingWebhookFields } from "@journal/shared";
import * as repo from "../db/repo.js";
import { transaction } from "../db/index.js";
import { secretsMatch } from "../auth.js";
import { deleteMediaFiles, kindFromMime } from "../media.js";
import { enqueueDaySummary, enqueueRecordTitle } from "../ai/jobs.js";
import { readMultipart } from "./records.js";

/** Devices retry; the same recording must not become two records. */
function dedupeKeyFor(recordedAt: number, transcription: string): string {
  return createHash("sha256").update(`${recordedAt}\n${transcription}`).digest("hex");
}

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app;

  app.post(
    "/api/webhooks/ring",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!config.WEBHOOK_TOKEN) {
        return reply.code(503).send({ error: "webhook_not_configured" });
      }
      const header = request.headers["x-webhook-token"];
      const query = (request.query as { token?: string }).token;
      const presented = (Array.isArray(header) ? header[0] : header) ?? query ?? "";
      if (!secretsMatch(presented, config.WEBHOOK_TOKEN)) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      if (!request.isMultipart()) {
        return reply.code(415).send({ error: "expected_multipart_form_data" });
      }

      const { fields, files } = await readMultipart(request, config.mediaDir, Date.now());
      const cleanup = () =>
        deleteMediaFiles(
          config.mediaDir,
          files.map((f) => f.relPath),
        );

      let parsed;
      try {
        parsed = RingWebhookFields.parse({
          transcription: fields.transcription?.[0],
          recordedAt: fields.recordedAt?.[0],
          client: fields.client?.[0] ?? "ring",
        });
      } catch (err) {
        await cleanup();
        throw err;
      }

      const dedupeKey = dedupeKeyFor(parsed.recordedAt, parsed.transcription);
      const existing = repo.findRecordByDedupeKey(db, dedupeKey);
      if (existing) {
        await cleanup();
        return reply.code(200).send({ ok: true, deduped: true, id: existing.id });
      }

      try {
        const record = transaction(db, () => {
          const created = repo.createRecord(db, {
            text: parsed.transcription,
            tags: [],
            timestamp: parsed.recordedAt,
            source: "ring",
            clientName: parsed.client,
            dedupeKey,
            timeZone: config.JOURNAL_TZ,
          });
          for (const file of files) {
            repo.insertMedia(db, {
              recordId: created.id,
              kind: kindFromMime(file.mimeType),
              relPath: file.relPath,
              mimeType: file.mimeType,
              originalName: file.originalName,
              sizeBytes: file.sizeBytes,
            });
          }
          enqueueRecordTitle(db, created.id);
          enqueueDaySummary(db, created.dayDate);
          return created;
        });
        return reply.code(201).send({ ok: true, id: record.id, dayDate: record.dayDate });
      } catch (err) {
        await cleanup();
        throw err;
      }
    },
  );
}
