import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import type { MediaKind } from "@journal/shared";
import { randomUUID } from "./ids.js";

const EXTENSIONS: Record<string, string> = {
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/webm": ".weba",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
};

export function kindFromMime(mime: string): MediaKind {
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

function extensionFor(mime: string, originalName?: string | null): string {
  const known = EXTENSIONS[mime.toLowerCase()];
  if (known) return known;
  const fromName = originalName ? path.extname(originalName) : "";
  return /^\.[a-z0-9]{1,8}$/i.test(fromName) ? fromName.toLowerCase() : ".bin";
}

export interface StoredFile {
  relPath: string;
  sizeBytes: number;
}

/**
 * Streams an upload to `<mediaDir>/<YYYY>/<MM>/<uuid><ext>`, writing to a
 * `.part` file first so a failed or truncated upload never leaves a partial
 * file that a media row points at.
 */
export async function storeUpload(
  mediaDir: string,
  stream: Readable,
  opts: { mimeType: string; originalName?: string | null; timestamp: number },
): Promise<StoredFile> {
  const date = new Date(opts.timestamp);
  const dir = path.join(
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
  );
  const name = `${randomUUID()}${extensionFor(opts.mimeType, opts.originalName)}`;
  const relPath = path.join(dir, name);
  const absolute = path.join(mediaDir, relPath);
  const temp = `${absolute}.part`;

  await fsp.mkdir(path.dirname(absolute), { recursive: true });
  try {
    await pipeline(stream, fs.createWriteStream(temp));
    const { size } = await fsp.stat(temp);
    await fsp.rename(temp, absolute);
    return { relPath, sizeBytes: size };
  } catch (err) {
    await fsp.rm(temp, { force: true });
    throw err;
  }
}

/** Guards against a `rel_path` escaping the media directory. */
export function resolveMediaPath(mediaDir: string, relPath: string): string {
  const absolute = path.resolve(mediaDir, relPath);
  const root = path.resolve(mediaDir);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new Error(`media path escapes storage root: ${relPath}`);
  }
  return absolute;
}

export async function deleteMediaFiles(mediaDir: string, relPaths: string[]): Promise<void> {
  await Promise.all(
    relPaths.map(async (rel) => {
      try {
        await fsp.rm(resolveMediaPath(mediaDir, rel), { force: true });
      } catch {
        // A missing file is not worth failing a delete over.
      }
    }),
  );
}
