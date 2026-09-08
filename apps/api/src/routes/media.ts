import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import fsp from "node:fs/promises";
import * as repo from "../db/repo.js";
import { resolveMediaPath } from "../media.js";

/** Parses a single-range `bytes=start-end` header against a known file size. */
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | "unsatisfiable" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match as unknown as [string, string, string];
  if (rawStart === "" && rawEnd === "") return null;

  let start: number;
  let end: number;
  if (rawStart === "") {
    // Suffix range: the last N bytes.
    const suffix = Number(rawEnd);
    if (suffix <= 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (start > end || start >= size) return "unsatisfiable";
  return { start, end };
}

export async function registerMediaRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app;

  app.get("/api/media/:id", async (request, reply) => {
    const row = repo.getMedia(db, (request.params as { id: string }).id);
    if (!row) return reply.code(404).send({ error: "not_found" });

    const absolute = resolveMediaPath(config.mediaDir, row.rel_path);
    let size: number;
    try {
      size = (await fsp.stat(absolute)).size;
    } catch {
      request.log.error({ id: row.id, path: row.rel_path }, "media file missing on disk");
      return reply.code(410).send({ error: "media_file_missing" });
    }

    reply
      .header("Content-Type", row.mime_type)
      .header("Accept-Ranges", "bytes")
      .header("Cache-Control", "private, max-age=31536000, immutable");
    if (row.original_name) {
      reply.header(
        "Content-Disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(row.original_name)}`,
      );
    }

    const range = parseRange(request.headers.range, size);
    if (range === "unsatisfiable") {
      return reply.code(416).header("Content-Range", `bytes */${size}`).send();
    }
    if (range) {
      // 206 with an explicit Content-Range is what makes audio seeking work.
      return reply
        .code(206)
        .header("Content-Range", `bytes ${range.start}-${range.end}/${size}`)
        .header("Content-Length", range.end - range.start + 1)
        .send(fs.createReadStream(absolute, { start: range.start, end: range.end }));
    }
    return reply.header("Content-Length", size).send(fs.createReadStream(absolute));
  });
}
