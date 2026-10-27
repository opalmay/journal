import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { DateKeySchema, addDays, normalizeTag, timeOfDay } from "@journal/shared";
import type { DayDTO, RecordDTO } from "@journal/shared";
import type { Db } from "../db/index.js";
import * as repo from "../db/repo.js";

// The journal as seen from an MCP client: three read-only tools, narrow on
// purpose, so a client asks for what it needs instead of the whole journal.

const ENTRIES_MAX_DAYS = 92;
const SERIES_MAX_DAYS = 366;

/** The numeric daily values; the text ones (exercise, intake…) live in get_entries. */
const SERIES_FIELDS = [
  "mood",
  "energy",
  "sleepHours",
  "sleepWakings",
  "napHours",
  "caffeine",
  "alcohol",
  "cycleDay",
] as const;
type SeriesField = (typeof SERIES_FIELDS)[number];

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;

function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Inclusive day count, or an error message when the range is unusable. */
function checkRange(from: string, to: string, max: number): string | null {
  if (from > to) return "`from` must not be after `to`.";
  if (addDays(from, max - 1) < to) return `Ask for at most ${max} days at a time; split the range.`;
  return null;
}

function entryOf(record: RecordDTO, timeZone: string) {
  return {
    date: record.dayDate,
    time: timeOfDay(record.timestamp, timeZone),
    title: record.title,
    text: record.text,
    tags: record.tags,
  };
}

function dayOf(day: DayDTO) {
  return {
    date: day.date,
    title: day.title,
    summary: day.summary,
    note: day.note,
    mood: day.mood,
    energy: day.metrics.energy,
    sleep: {
      hours: day.metrics.sleepHours,
      quality: day.metrics.sleepQuality,
      wakings: day.metrics.sleepWakings,
      napHours: day.metrics.napHours,
      napTimes: day.metrics.napTimes,
    },
    tags: day.tags,
  };
}

export function buildMcpServer(db: Db, timeZone: string): McpServer {
  const server = new McpServer(
    { name: "journal", version: "1.0.0" },
    {
      instructions:
        "A personal journal. Dates are YYYY-MM-DD in the journal's timezone " +
        `(${timeZone}). Mood and energy are 1–5; sleep and naps are in hours.`,
    },
  );

  const { trackCycle } = repo.getPreferences(db);
  const seriesFields = SERIES_FIELDS.filter((f) => f !== "cycleDay" || trackCycle) as [
    SeriesField,
    ...SeriesField[],
  ];

  server.registerTool(
    "get_entries",
    {
      title: "Get journal entries",
      description:
        `Days between two dates (inclusive, at most ${ENTRIES_MAX_DAYS}), oldest first: ` +
        "each day's title, summary, note, mood, energy, sleep and tags, with its entries' " +
        "time, title, text and tags. Days with nothing written are left out.",
      inputSchema: { from: DateKeySchema, to: DateKeySchema },
      annotations: READ_ONLY,
    },
    async ({ from, to }) => {
      const problem = checkRange(from, to, ENTRIES_MAX_DAYS);
      if (problem) return fail(problem);
      const days = repo.listDays(db, from, to).reverse();
      return json({
        days: days.map((day) => ({
          ...dayOf(day),
          entries: repo.listRecordsForDay(db, day.date).map((r) => {
            const { date: _date, ...entry } = entryOf(r, timeZone);
            return entry;
          }),
        })),
      });
    },
  );

  server.registerTool(
    "get_daily_series",
    {
      title: "Get daily values",
      description:
        `Numeric daily values between two dates (inclusive, at most ${SERIES_MAX_DAYS}), ` +
        "one value per date and field, null where nothing was recorded. For charts and comparisons.",
      inputSchema: {
        from: DateKeySchema,
        to: DateKeySchema,
        fields: z.array(z.enum(seriesFields)).min(1),
      },
      annotations: READ_ONLY,
    },
    async ({ from, to, fields }) => {
      const problem = checkRange(from, to, SERIES_MAX_DAYS);
      if (problem) return fail(problem);
      const byDate = new Map(repo.listDays(db, from, to).map((d) => [d.date, d]));
      const dates: string[] = [];
      for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
      const value = (day: DayDTO | undefined, field: SeriesField): number | null =>
        day ? (field === "mood" ? day.mood : day.metrics[field]) : null;
      const unique = [...new Set(fields)];
      return json({
        dates,
        series: Object.fromEntries(
          unique.map((field) => [field, dates.map((d) => value(byDate.get(d), field))]),
        ),
      });
    },
  );

  server.registerTool(
    "search_entries",
    {
      title: "Search journal entries",
      description:
        "Finds entries by keyword (the last word also matches as a prefix), newest first. " +
        "A query of `#tag`, or exactly a tag's name, also finds days tagged with it.",
      inputSchema: {
        query: z.string().trim().min(1).max(200),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: READ_ONLY,
    },
    async ({ query, limit }) => {
      const tagName = normalizeTag(query);
      const isTag =
        tagName !== "" &&
        (query.startsWith("#") || repo.listTags(db).some((t) => t.name === tagName));

      const found = new Map<string, RecordDTO>();
      if (!query.startsWith("#")) {
        for (const r of repo.listRecords(db, { q: query, limit }).records) found.set(r.id, r);
      }
      if (isTag) {
        for (const r of repo.listRecords(db, { tag: tagName, limit }).records) found.set(r.id, r);
      }
      const entries = [...found.values()]
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit)
        .map((r) => entryOf(r, timeZone));

      return json({
        entries,
        ...(isTag ? { days: repo.listDaysWithTag(db, tagName, limit).map(dayOf) } : {}),
      });
    },
  );

  return server;
}
