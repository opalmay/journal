import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeContext, multipart, type TestContext } from "./helpers.js";

const BERLIN_2026_09_08_1200 = Date.parse("2026-09-08T10:00:00Z");

describe("records", () => {
  let ctx: TestContext;
  const auth = () => ({ cookie: ctx.cookie });

  beforeEach(async () => {
    ctx = await makeContext();
  });
  afterEach(async () => {
    await ctx.close();
  });

  const createRecord = async (payload: Record<string, unknown>) =>
    ctx.app.inject({ method: "POST", url: "/api/records", headers: auth(), payload });

  it("requires a session", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/api/records" });
    expect(response.statusCode).toBe(401);
  });

  it("creates, reads, updates and deletes a record", async () => {
    const created = await createRecord({
      text: "first entry",
      tags: ["#Deep Work", "reading"],
      timestamp: BERLIN_2026_09_08_1200,
    });
    expect(created.statusCode).toBe(201);
    const record = created.json();
    expect(record.tags).toEqual(["deep-work", "reading"]);
    expect(record.dayDate).toBe("2026-09-08");
    expect(record.source).toBe("web");

    const patched = await ctx.app.inject({
      method: "PATCH",
      url: `/api/records/${record.id}`,
      headers: auth(),
      payload: { text: "first entry, revised", tags: ["reading"] },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().text).toBe("first entry, revised");
    expect(patched.json().tags).toEqual(["reading"]);

    const deleted = await ctx.app.inject({
      method: "DELETE",
      url: `/api/records/${record.id}`,
      headers: auth(),
    });
    expect(deleted.statusCode).toBe(204);

    const gone = await ctx.app.inject({
      method: "GET",
      url: `/api/records/${record.id}`,
      headers: auth(),
    });
    expect(gone.statusCode).toBe(404);
  });

  it("rejects an entry with neither text nor media", async () => {
    const response = await createRecord({ text: "   " });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("record_is_empty");
  });

  it("defaults the timestamp to now", async () => {
    const before = Date.now();
    const record = (await createRecord({ text: "no timestamp given" })).json();
    expect(record.timestamp).toBeGreaterThanOrEqual(before);
    expect(record.timestamp).toBeLessThanOrEqual(Date.now());
  });

  it("re-homes a record when its timestamp crosses local midnight", async () => {
    const record = (
      await createRecord({ text: "late night", timestamp: Date.parse("2026-09-08T21:30:00Z") })
    ).json();
    expect(record.dayDate).toBe("2026-09-08"); // 23:30 Berlin

    const moved = await ctx.app.inject({
      method: "PATCH",
      url: `/api/records/${record.id}`,
      headers: auth(),
      payload: { timestamp: Date.parse("2026-09-08T22:30:00Z") }, // 00:30 Berlin, next day
    });
    expect(moved.json().dayDate).toBe("2026-09-09");

    const oldDay = await ctx.app
      .inject({ method: "GET", url: "/api/days/2026-09-08", headers: auth() })
      .then((r) => r.json());
    expect(oldDay.records).toHaveLength(0);
    expect(oldDay.recordCount).toBe(0);

    const newDay = await ctx.app
      .inject({ method: "GET", url: "/api/days/2026-09-09", headers: auth() })
      .then((r) => r.json());
    expect(newDay.records).toHaveLength(1);
  });

  it("stores uploads sent as multipart", async () => {
    const body = multipart(
      [
        { name: "text", value: "with a picture" },
        { name: "tags", value: "photo,walk" },
        { name: "timestamp", value: String(BERLIN_2026_09_08_1200) },
      ],
      [
        {
          name: "file",
          filename: "walk.png",
          contentType: "image/png",
          content: Buffer.from("not really a png"),
        },
      ],
    );
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/records",
      headers: { ...body.headers, ...auth() },
      payload: body.payload,
    });
    expect(response.statusCode).toBe(201);
    const record = response.json();
    expect(record.tags).toEqual(["photo", "walk"]);
    expect(record.media[0].kind).toBe("image");
    expect(record.media[0].url).toBe(`/api/media/${record.media[0].id}`);
  });

  it("filters by tag, date range and full-text query", async () => {
    await createRecord({
      text: "coffee with Marta at the harbour",
      tags: ["social"],
      timestamp: Date.parse("2026-09-08T10:00:00Z"),
    });
    await createRecord({
      text: "debugged the ingest pipeline",
      tags: ["work"],
      timestamp: Date.parse("2026-09-09T10:00:00Z"),
    });

    const byTag = await ctx.app
      .inject({ method: "GET", url: "/api/records?tag=work", headers: auth() })
      .then((r) => r.json());
    expect(byTag.records).toHaveLength(1);
    expect(byTag.records[0].text).toContain("ingest");

    const byRange = await ctx.app
      .inject({
        method: "GET",
        url: "/api/records?from=2026-09-08&to=2026-09-08",
        headers: auth(),
      })
      .then((r) => r.json());
    expect(byRange.records).toHaveLength(1);
    expect(byRange.records[0].text).toContain("harbour");

    const bySearch = await ctx.app
      .inject({ method: "GET", url: "/api/records?q=harb", headers: auth() })
      .then((r) => r.json());
    expect(bySearch.records).toHaveLength(1);

    const noMatch = await ctx.app
      .inject({ method: "GET", url: "/api/records?q=kayaking", headers: auth() })
      .then((r) => r.json());
    expect(noMatch.records).toHaveLength(0);
  });

  it("pages with a cursor, newest first", async () => {
    for (let i = 0; i < 3; i++) {
      await createRecord({ text: `entry ${i}`, timestamp: BERLIN_2026_09_08_1200 + i * 1000 });
    }
    const first = await ctx.app
      .inject({ method: "GET", url: "/api/records?limit=2", headers: auth() })
      .then((r) => r.json());
    expect(first.records.map((r: { text: string }) => r.text)).toEqual(["entry 2", "entry 1"]);
    expect(first.nextCursor).toBeTruthy();

    const second = await ctx.app
      .inject({
        method: "GET",
        url: `/api/records?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
        headers: auth(),
      })
      .then((r) => r.json());
    expect(second.records.map((r: { text: string }) => r.text)).toEqual(["entry 0"]);
    expect(second.nextCursor).toBeNull();
  });
});

describe("days", () => {
  let ctx: TestContext;
  const auth = () => ({ cookie: ctx.cookie });

  beforeEach(async () => {
    ctx = await makeContext();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("returns an empty day for a date nothing has touched", async () => {
    const day = await ctx.app
      .inject({ method: "GET", url: "/api/days/2026-01-01", headers: auth() })
      .then((r) => r.json());
    expect(day).toMatchObject({ date: "2026-01-01", mood: null, records: [], recordCount: 0 });
  });

  it("stores mood, note and tags", async () => {
    const response = await ctx.app.inject({
      method: "PATCH",
      url: "/api/days/2026-09-08",
      headers: auth(),
      payload: { mood: 4, note: "steady day", tags: ["Rest Day"] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ mood: 4, note: "steady day", tags: ["rest-day"] });
  });

  it("rejects a mood outside 1-5", async () => {
    for (const mood of [0, 6, 2.5]) {
      const response = await ctx.app.inject({
        method: "PATCH",
        url: "/api/days/2026-09-08",
        headers: auth(),
        payload: { mood },
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it("lists days in a range with record counts", async () => {
    await ctx.app.inject({
      method: "POST",
      url: "/api/records",
      headers: auth(),
      payload: { text: "one", timestamp: Date.parse("2026-09-08T10:00:00Z") },
    });
    await ctx.app.inject({
      method: "POST",
      url: "/api/records",
      headers: auth(),
      payload: { text: "two", timestamp: Date.parse("2026-09-08T11:00:00Z") },
    });

    const days = await ctx.app
      .inject({
        method: "GET",
        url: "/api/days?from=2026-09-01&to=2026-09-30",
        headers: auth(),
      })
      .then((r) => r.json());
    expect(days.days).toHaveLength(1);
    expect(days.days[0]).toMatchObject({ date: "2026-09-08", recordCount: 2 });
  });
});
