import type { Db } from "./index.js";
import { transaction } from "./index.js";
import { uuidv7, randomUUID } from "../ids.js";
import { dateKeyFromTimestamp, normalizeTag } from "@journal/shared";
import type {
  DayDTO,
  DayDetailDTO,
  MediaDTO,
  MediaKind,
  RecordDTO,
  RecordSource,
  TagDTO,
} from "@journal/shared";

// --- row shapes ----------------------------------------------------------

interface DayRow {
  date: string;
  title: string | null;
  summary: string | null;
  note: string | null;
  mood: number | null;
  ai_generated_at: number | null;
  created_at: number;
  updated_at: number;
}

interface RecordRow {
  id: string;
  day_date: string;
  timestamp: number;
  text: string;
  title: string | null;
  source: string;
  client_name: string | null;
  dedupe_key: string | null;
  ai_generated_at: number | null;
  created_at: number;
  updated_at: number;
}

interface MediaRow {
  id: string;
  record_id: string;
  kind: string;
  rel_path: string;
  mime_type: string;
  original_name: string | null;
  size_bytes: number;
  duration_ms: number | null;
  created_at: number;
}

// --- days ----------------------------------------------------------------

/** Creates the day row if it does not exist yet. Days are never pre-seeded. */
export function ensureDay(db: Db, date: string, now = Date.now()): void {
  db.prepare(
    `INSERT INTO days (date, created_at, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (date) DO NOTHING`,
  ).run(date, now, now);
}

function toDayDTO(row: DayRow, tags: string[], recordCount: number): DayDTO {
  return {
    date: row.date,
    title: row.title,
    summary: row.summary,
    note: row.note,
    mood: row.mood as DayDTO["mood"],
    tags,
    recordCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listDays(db: Db, from: string, to: string): DayDTO[] {
  const rows = db
    .prepare(`SELECT * FROM days WHERE date BETWEEN ? AND ? ORDER BY date DESC`)
    .all(from, to) as unknown as DayRow[];
  if (rows.length === 0) return [];
  const dates = rows.map((r) => r.date);
  const tags = tagsByDay(db, dates);
  const counts = recordCountsByDay(db, dates);
  return rows.map((r) => toDayDTO(r, tags.get(r.date) ?? [], counts.get(r.date) ?? 0));
}

export function getDay(db: Db, date: string): DayDTO | null {
  const row = db.prepare(`SELECT * FROM days WHERE date = ?`).get(date) as unknown as
    | DayRow
    | undefined;
  if (!row) return null;
  return toDayDTO(
    row,
    tagsByDay(db, [date]).get(date) ?? [],
    recordCountsByDay(db, [date]).get(date) ?? 0,
  );
}

export function getDayDetail(db: Db, date: string): DayDetailDTO | null {
  const day = getDay(db, date);
  if (!day) return null;
  return { ...day, records: listRecordsForDay(db, date) };
}

export interface DayPatch {
  mood?: number | null;
  note?: string | null;
  title?: string | null;
  summary?: string | null;
  tags?: string[];
}

export function updateDay(db: Db, date: string, patch: DayPatch): DayDTO | null {
  return transaction(db, () => {
    ensureDay(db, date);
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    for (const key of ["mood", "note", "title", "summary"] as const) {
      if (patch[key] !== undefined) {
        sets.push(`${key} = ?`);
        values.push(patch[key] as string | number | null);
      }
    }
    if (sets.length > 0) {
      sets.push("updated_at = ?");
      values.push(Date.now(), date);
      db.prepare(`UPDATE days SET ${sets.join(", ")} WHERE date = ?`).run(...values);
    }
    if (patch.tags !== undefined) setDayTags(db, date, patch.tags);
    return getDay(db, date);
  });
}

/** Removes days that hold neither records nor anything the user typed. */
export function pruneEmptyDay(db: Db, date: string): void {
  db.prepare(
    `DELETE FROM days
      WHERE date = ?
        AND mood IS NULL AND note IS NULL AND title IS NULL AND summary IS NULL
        AND NOT EXISTS (SELECT 1 FROM records WHERE day_date = ?)
        AND NOT EXISTS (SELECT 1 FROM day_tags WHERE day_date = ?)`,
  ).run(date, date, date);
}

// --- tags ----------------------------------------------------------------

function tagIdsFor(db: Db, names: string[]): string[] {
  const now = Date.now();
  const insert = db.prepare(
    `INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING`,
  );
  const select = db.prepare(`SELECT id FROM tags WHERE name = ?`);
  const ids: string[] = [];
  for (const raw of names) {
    const name = normalizeTag(raw);
    if (!name) continue;
    insert.run(randomUUID(), name, now);
    const row = select.get(name) as unknown as { id: string } | undefined;
    if (row) ids.push(row.id);
  }
  return ids;
}

function placeholders(n: number): string {
  return new Array(n).fill("?").join(", ");
}

function tagsByDay(db: Db, dates: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (dates.length === 0) return out;
  const rows = db
    .prepare(
      `SELECT dt.day_date AS day_date, t.name AS name
         FROM day_tags dt JOIN tags t ON t.id = dt.tag_id
        WHERE dt.day_date IN (${placeholders(dates.length)})
        ORDER BY t.name`,
    )
    .all(...dates) as unknown as { day_date: string; name: string }[];
  for (const r of rows) {
    const list = out.get(r.day_date) ?? [];
    list.push(r.name);
    out.set(r.day_date, list);
  }
  return out;
}

function recordCountsByDay(db: Db, dates: string[]): Map<string, number> {
  const out = new Map<string, number>();
  if (dates.length === 0) return out;
  const rows = db
    .prepare(
      `SELECT day_date, COUNT(*) AS n FROM records
        WHERE day_date IN (${placeholders(dates.length)}) GROUP BY day_date`,
    )
    .all(...dates) as unknown as { day_date: string; n: number }[];
  for (const r of rows) out.set(r.day_date, r.n);
  return out;
}

function tagsByRecord(db: Db, ids: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (ids.length === 0) return out;
  const rows = db
    .prepare(
      `SELECT rt.record_id AS record_id, t.name AS name
         FROM record_tags rt JOIN tags t ON t.id = rt.tag_id
        WHERE rt.record_id IN (${placeholders(ids.length)})
        ORDER BY t.name`,
    )
    .all(...ids) as unknown as { record_id: string; name: string }[];
  for (const r of rows) {
    const list = out.get(r.record_id) ?? [];
    list.push(r.name);
    out.set(r.record_id, list);
  }
  return out;
}

export function setRecordTags(db: Db, recordId: string, names: string[]): void {
  const ids = tagIdsFor(db, names);
  db.prepare(`DELETE FROM record_tags WHERE record_id = ?`).run(recordId);
  const insert = db.prepare(
    `INSERT INTO record_tags (record_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING`,
  );
  for (const id of ids) insert.run(recordId, id);
}

export function setDayTags(db: Db, date: string, names: string[]): void {
  const ids = tagIdsFor(db, names);
  db.prepare(`DELETE FROM day_tags WHERE day_date = ?`).run(date);
  const insert = db.prepare(
    `INSERT INTO day_tags (day_date, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING`,
  );
  for (const id of ids) insert.run(date, id);
}

/** Adds tags to a day without removing any the user put there. */
export function addDayTags(db: Db, date: string, names: string[]): void {
  const ids = tagIdsFor(db, names);
  const insert = db.prepare(
    `INSERT INTO day_tags (day_date, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING`,
  );
  for (const id of ids) insert.run(date, id);
}

export function listTags(db: Db): TagDTO[] {
  return db
    .prepare(
      `SELECT t.name AS name,
              (SELECT COUNT(*) FROM record_tags rt WHERE rt.tag_id = t.id) AS recordCount,
              (SELECT COUNT(*) FROM day_tags dt WHERE dt.tag_id = t.id) AS dayCount
         FROM tags t
        ORDER BY recordCount + dayCount DESC, t.name`,
    )
    .all() as unknown as TagDTO[];
}

/** Drops tags nothing references any more, so the tag list stays honest. */
export function pruneOrphanTags(db: Db): void {
  db.exec(
    `DELETE FROM tags
      WHERE NOT EXISTS (SELECT 1 FROM record_tags WHERE tag_id = tags.id)
        AND NOT EXISTS (SELECT 1 FROM day_tags WHERE tag_id = tags.id)`,
  );
}

// --- media ---------------------------------------------------------------

function toMediaDTO(row: MediaRow): MediaDTO {
  return {
    id: row.id,
    kind: row.kind as MediaKind,
    mimeType: row.mime_type,
    originalName: row.original_name,
    sizeBytes: row.size_bytes,
    url: `/api/media/${row.id}`,
  };
}

export interface NewMedia {
  recordId: string;
  kind: MediaKind;
  relPath: string;
  mimeType: string;
  originalName: string | null;
  sizeBytes: number;
}

export function insertMedia(db: Db, m: NewMedia): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO media (id, record_id, kind, rel_path, mime_type, original_name, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, m.recordId, m.kind, m.relPath, m.mimeType, m.originalName, m.sizeBytes, Date.now());
  return id;
}

export function getMedia(db: Db, id: string): MediaRow | null {
  return (db.prepare(`SELECT * FROM media WHERE id = ?`).get(id) as unknown as MediaRow) ?? null;
}

export function listMediaPathsForRecord(db: Db, recordId: string): string[] {
  return (
    db.prepare(`SELECT rel_path FROM media WHERE record_id = ?`).all(recordId) as unknown as {
      rel_path: string;
    }[]
  ).map((r) => r.rel_path);
}

function mediaByRecord(db: Db, ids: string[]): Map<string, MediaDTO[]> {
  const out = new Map<string, MediaDTO[]>();
  if (ids.length === 0) return out;
  const rows = db
    .prepare(
      `SELECT * FROM media WHERE record_id IN (${placeholders(ids.length)}) ORDER BY created_at`,
    )
    .all(...ids) as unknown as MediaRow[];
  for (const r of rows) {
    const list = out.get(r.record_id) ?? [];
    list.push(toMediaDTO(r));
    out.set(r.record_id, list);
  }
  return out;
}

// --- records -------------------------------------------------------------

function hydrateRecords(db: Db, rows: RecordRow[]): RecordDTO[] {
  const ids = rows.map((r) => r.id);
  const tags = tagsByRecord(db, ids);
  const media = mediaByRecord(db, ids);
  return rows.map((r) => ({
    id: r.id,
    dayDate: r.day_date,
    timestamp: r.timestamp,
    text: r.text,
    title: r.title,
    source: r.source as RecordSource,
    clientName: r.client_name,
    tags: tags.get(r.id) ?? [],
    media: media.get(r.id) ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export interface NewRecord {
  text: string;
  tags: string[];
  timestamp: number;
  source: RecordSource;
  clientName?: string | null;
  dedupeKey?: string | null;
  timeZone: string;
}

export function createRecord(db: Db, input: NewRecord): RecordDTO {
  return transaction(db, () => {
    const now = Date.now();
    const id = uuidv7(now);
    const dayDate = dateKeyFromTimestamp(input.timestamp, input.timeZone);
    ensureDay(db, dayDate, now);
    db.prepare(
      `INSERT INTO records
         (id, day_date, timestamp, text, source, client_name, dedupe_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      dayDate,
      input.timestamp,
      input.text,
      input.source,
      input.clientName ?? null,
      input.dedupeKey ?? null,
      now,
      now,
    );
    setRecordTags(db, id, input.tags);
    return getRecord(db, id)!;
  });
}

export function getRecord(db: Db, id: string): RecordDTO | null {
  const row = db.prepare(`SELECT * FROM records WHERE id = ?`).get(id) as unknown as
    | RecordRow
    | undefined;
  if (!row) return null;
  return hydrateRecords(db, [row])[0]!;
}

export function findRecordByDedupeKey(db: Db, key: string): RecordDTO | null {
  const row = db.prepare(`SELECT * FROM records WHERE dedupe_key = ?`).get(key) as unknown as
    | RecordRow
    | undefined;
  return row ? hydrateRecords(db, [row])[0]! : null;
}

export function listRecordsForDay(db: Db, date: string): RecordDTO[] {
  const rows = db
    .prepare(`SELECT * FROM records WHERE day_date = ? ORDER BY timestamp ASC, id ASC`)
    .all(date) as unknown as RecordRow[];
  return hydrateRecords(db, rows);
}

export interface RecordFilter {
  from?: string;
  to?: string;
  tag?: string;
  q?: string;
  limit: number;
  cursor?: string;
}

export interface RecordPage {
  records: RecordDTO[];
  nextCursor: string | null;
}

/** Escapes user input into an FTS5 phrase query with a trailing prefix match. */
function ftsQuery(q: string): string {
  const terms = q
    .split(/\s+/)
    .map((t) => t.replace(/"/g, ""))
    .filter(Boolean)
    .map((t) => `"${t}"`);
  if (terms.length === 0) return '""';
  terms[terms.length - 1] = `${terms[terms.length - 1]}*`;
  return terms.join(" ");
}

export function listRecords(db: Db, filter: RecordFilter): RecordPage {
  const where: string[] = [];
  const values: (string | number)[] = [];

  if (filter.from) {
    where.push("r.day_date >= ?");
    values.push(filter.from);
  }
  if (filter.to) {
    where.push("r.day_date <= ?");
    values.push(filter.to);
  }
  if (filter.tag) {
    where.push(
      `EXISTS (SELECT 1 FROM record_tags rt JOIN tags t ON t.id = rt.tag_id
                WHERE rt.record_id = r.id AND t.name = ?)`,
    );
    values.push(normalizeTag(filter.tag));
  }
  if (filter.q) {
    where.push(`r.rowid IN (SELECT rowid FROM records_fts WHERE records_fts MATCH ?)`);
    values.push(ftsQuery(filter.q));
  }
  if (filter.cursor) {
    const [ts, id] = filter.cursor.split("|");
    if (ts && id) {
      where.push("(r.timestamp < ? OR (r.timestamp = ? AND r.id < ?))");
      values.push(Number(ts), Number(ts), id);
    }
  }

  const sql = `SELECT r.* FROM records r
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY r.timestamp DESC, r.id DESC
    LIMIT ?`;
  const rows = db.prepare(sql).all(...values, filter.limit + 1) as unknown as RecordRow[];

  const hasMore = rows.length > filter.limit;
  const page = hasMore ? rows.slice(0, filter.limit) : rows;
  const last = page[page.length - 1];
  return {
    records: hydrateRecords(db, page),
    nextCursor: hasMore && last ? `${last.timestamp}|${last.id}` : null,
  };
}

export interface RecordPatch {
  text?: string;
  title?: string | null;
  tags?: string[];
  timestamp?: number;
}

export interface RecordUpdateResult {
  record: RecordDTO;
  /** Days whose contents changed — both the old and new day on a re-home. */
  affectedDays: string[];
}

export function updateRecord(
  db: Db,
  id: string,
  patch: RecordPatch,
  timeZone: string,
): RecordUpdateResult | null {
  return transaction(db, () => {
    const existing = db.prepare(`SELECT * FROM records WHERE id = ?`).get(id) as unknown as
      | RecordRow
      | undefined;
    if (!existing) return null;

    const affected = new Set<string>([existing.day_date]);
    const sets: string[] = [];
    const values: (string | number | null)[] = [];

    if (patch.text !== undefined) {
      sets.push("text = ?");
      values.push(patch.text);
    }
    if (patch.title !== undefined) {
      sets.push("title = ?");
      values.push(patch.title);
    }
    if (patch.timestamp !== undefined && patch.timestamp !== existing.timestamp) {
      const newDay = dateKeyFromTimestamp(patch.timestamp, timeZone);
      ensureDay(db, newDay);
      sets.push("timestamp = ?", "day_date = ?");
      values.push(patch.timestamp, newDay);
      affected.add(newDay);
    }
    if (sets.length > 0) {
      sets.push("updated_at = ?");
      values.push(Date.now(), id);
      db.prepare(`UPDATE records SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    }
    if (patch.tags !== undefined) setRecordTags(db, id, patch.tags);

    // A re-homed record can leave its old day empty.
    for (const d of affected) if (d !== existing.day_date || patch.timestamp) pruneEmptyDay(db, d);

    const record = getRecord(db, id);
    return record ? { record, affectedDays: [...affected] } : null;
  });
}

export interface DeletedRecord {
  dayDate: string;
  mediaPaths: string[];
}

export function deleteRecord(db: Db, id: string): DeletedRecord | null {
  return transaction(db, () => {
    const row = db.prepare(`SELECT day_date FROM records WHERE id = ?`).get(id) as unknown as
      | { day_date: string }
      | undefined;
    if (!row) return null;
    const mediaPaths = listMediaPathsForRecord(db, id);
    db.prepare(`DELETE FROM records WHERE id = ?`).run(id);
    pruneEmptyDay(db, row.day_date);
    pruneOrphanTags(db);
    return { dayDate: row.day_date, mediaPaths };
  });
}

export function setRecordTitle(db: Db, id: string, title: string): void {
  db.prepare(`UPDATE records SET title = ?, ai_generated_at = ?, updated_at = ? WHERE id = ?`).run(
    title,
    Date.now(),
    Date.now(),
    id,
  );
}

export function setDaySummary(
  db: Db,
  date: string,
  data: { title: string; summary: string; tags: string[] },
): void {
  transaction(db, () => {
    db.prepare(
      `UPDATE days SET title = ?, summary = ?, ai_generated_at = ?, updated_at = ? WHERE date = ?`,
    ).run(data.title, data.summary, Date.now(), Date.now(), date);
    addDayTags(db, date, data.tags);
  });
}

export function storageUsage(db: Db): { files: number; bytes: number } {
  const row = db
    .prepare(`SELECT COUNT(*) AS files, COALESCE(SUM(size_bytes), 0) AS bytes FROM media`)
    .get() as unknown as { files: number; bytes: number };
  return { files: row.files, bytes: row.bytes };
}
