import type { FastifyInstance, FastifyRequest } from "fastify";
import { CreateRecordInput, RecordQuery, UpdateRecordInput } from "@journal/shared";
import * as repo from "../db/repo.js";
import { transaction } from "../db/index.js";
import { deleteMediaFiles, kindFromMime, storeUpload } from "../media.js";
import { enqueueDaySummary, enqueueRecordTitle } from "../ai/jobs.js";

interface PendingMedia {
  relPath: string;
  sizeBytes: number;
  mimeType: string;
  originalName: string | null;
}

/**
 * Reads a multipart request, streaming every file part to disk and collecting
 * the text fields. Files land on disk before the record row exists, so a
 * failure after this point must clean them up — see the callers.
 */
export async function readMultipart(
  request: FastifyRequest,
  mediaDir: string,
  timestampHint: number,
): Promise<{ fields: Record<string, string[]>; files: PendingMedia[] }> {
  const fields: Record<string, string[]> = {};
  const files: PendingMedia[] = [];

  try {
    for await (const part of request.parts()) {
      if (part.type === "file") {
        const stored = await storeUpload(mediaDir, part.file, {
          mimeType: part.mimetype,
          originalName: part.filename,
          timestamp: timestampHint,
        });
        if (part.file.truncated) {
          await deleteMediaFiles(mediaDir, [stored.relPath]);
          const err = new Error("upload exceeds MAX_UPLOAD_BYTES");
          (err as Error & { statusCode?: number }).statusCode = 413;
          throw err;
        }
        files.push({
          ...stored,
          mimeType: part.mimetype,
          originalName: part.filename ?? null,
        });
      } else {
        const value = typeof part.value === "string" ? part.value : String(part.value);
        (fields[part.fieldname] ??= []).push(value);
      }
    }
  } catch (err) {
    await deleteMediaFiles(
      mediaDir,
      files.map((f) => f.relPath),
    );
    throw err;
  }

  return { fields, files };
}

/** Tags may arrive as repeated fields, a JSON array, or a comma-separated list. */
export function parseTagField(values: string[] | undefined): string[] {
  if (!values || values.length === 0) return [];
  if (values.length === 1) {
    const only = values[0]!.trim();
    if (only.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(only);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        // fall through to comma splitting
      }
    }
    return only.split(",");
  }
  return values;
}

export async function registerRecordRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app;

  app.get("/api/records", async (request) => {
    const query = RecordQuery.parse(request.query);
    const page = repo.listRecords(db, query);
    return page;
  });

  app.get("/api/records/:id", async (request, reply) => {
    const record = repo.getRecord(db, (request.params as { id: string }).id);
    if (!record) return reply.code(404).send({ error: "not_found" });
    return record;
  });

  app.post("/api/records", async (request, reply) => {
    const now = Date.now();
    let input: { text: string; tags: string[]; timestamp?: number };
    let files: PendingMedia[] = [];

    if (request.isMultipart()) {
      const parsed = await readMultipart(request, config.mediaDir, now);
      files = parsed.files;
      try {
        input = CreateRecordInput.parse({
          text: parsed.fields.text?.[0] ?? "",
          tags: parseTagField(parsed.fields.tags),
          timestamp: parsed.fields.timestamp?.[0],
        });
      } catch (err) {
        await deleteMediaFiles(
          config.mediaDir,
          files.map((f) => f.relPath),
        );
        throw err;
      }
    } else {
      input = CreateRecordInput.parse(request.body ?? {});
    }

    if (!input.text.trim() && files.length === 0) {
      return reply.code(400).send({ error: "record_is_empty" });
    }

    const timestamp = input.timestamp ?? now;
    try {
      const record = transaction(db, () => {
        const created = repo.createRecord(db, {
          text: input.text,
          tags: input.tags,
          timestamp,
          source: "web",
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
        if (created.text.trim()) enqueueRecordTitle(db, created.id);
        enqueueDaySummary(db, created.dayDate);
        return repo.getRecord(db, created.id)!;
      });
      return reply.code(201).send(record);
    } catch (err) {
      await deleteMediaFiles(
        config.mediaDir,
        files.map((f) => f.relPath),
      );
      throw err;
    }
  });

  app.patch("/api/records/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const patch = UpdateRecordInput.parse(request.body);
    const result = repo.updateRecord(db, id, patch, config.JOURNAL_TZ);
    if (!result) return reply.code(404).send({ error: "not_found" });

    // Editing the text invalidates the AI title; a manual title wins outright.
    if (patch.text !== undefined && patch.title === undefined && result.record.text.trim()) {
      enqueueRecordTitle(db, id);
    }
    for (const date of result.affectedDays) enqueueDaySummary(db, date);
    return result.record;
  });

  app.delete("/api/records/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const deleted = repo.deleteRecord(db, id);
    if (!deleted) return reply.code(404).send({ error: "not_found" });
    await deleteMediaFiles(config.mediaDir, deleted.mediaPaths);
    if (repo.getDay(db, deleted.dayDate)) enqueueDaySummary(db, deleted.dayDate);
    return reply.code(204).send();
  });

  app.post("/api/records/:id/regenerate", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const record = repo.getRecord(db, id);
    if (!record) return reply.code(404).send({ error: "not_found" });
    if (!app.worker) return reply.code(503).send({ error: "ai_disabled" });
    enqueueRecordTitle(db, id);
    void app.worker.tick();
    return { queued: true };
  });
}
