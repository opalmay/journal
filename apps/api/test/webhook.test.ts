import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeContext, multipart, TEST_WEBHOOK_TOKEN, type TestContext } from "./helpers.js";

const AUDIO = Buffer.from("fake m4a bytes, but real enough for a byte count");
const RECORDED_AT = Date.parse("2026-09-08T10:15:00Z");

function ringBody(overrides: { transcription?: string; recordedAt?: number } = {}, withAudio = true) {
  return multipart(
    [
      { name: "transcription", value: overrides.transcription ?? "walked by the river, felt good" },
      { name: "recordedAt", value: String(overrides.recordedAt ?? RECORDED_AT) },
      { name: "client", value: "ring" },
    ],
    withAudio
      ? [{ name: "audio", filename: "rec.m4a", contentType: "audio/mp4", content: AUDIO }]
      : [],
  );
}

describe("POST /api/webhooks/ring", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await makeContext();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("creates a ring record with the audio stored on disk", async () => {
    const body = ringBody();
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/webhooks/ring",
      headers: { ...body.headers, "x-webhook-token": TEST_WEBHOOK_TOKEN },
      payload: body.payload,
    });

    expect(response.statusCode).toBe(201);
    const { id } = response.json<{ id: string }>();

    const record = await ctx.app
      .inject({ method: "GET", url: `/api/records/${id}`, headers: { cookie: ctx.cookie } })
      .then((r) => r.json());

    expect(record.source).toBe("ring");
    expect(record.clientName).toBe("ring");
    expect(record.timestamp).toBe(RECORDED_AT);
    expect(record.text).toBe("walked by the river, felt good");
    // 10:15 UTC is 12:15 Berlin time, so the day key is the local one.
    expect(record.dayDate).toBe("2026-09-08");
    expect(record.media).toHaveLength(1);
    expect(record.media[0].kind).toBe("audio");
    expect(record.media[0].sizeBytes).toBe(AUDIO.length);

    const files = fs.readdirSync(path.join(ctx.config.mediaDir, "2026", "09"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.m4a$/);
    expect(files[0]).not.toMatch(/\.part$/);
  });

  it("accepts a delivery with no audio part", async () => {
    const body = ringBody({}, false);
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/webhooks/ring",
      headers: { ...body.headers, "x-webhook-token": TEST_WEBHOOK_TOKEN },
      payload: body.payload,
    });
    expect(response.statusCode).toBe(201);

    const record = await ctx.app
      .inject({
        method: "GET",
        url: `/api/records/${response.json<{ id: string }>().id}`,
        headers: { cookie: ctx.cookie },
      })
      .then((r) => r.json());
    expect(record.media).toHaveLength(0);
  });

  it("dedupes a replayed delivery instead of creating a second record", async () => {
    const send = async () => {
      const body = ringBody();
      return ctx.app.inject({
        method: "POST",
        url: "/api/webhooks/ring",
        headers: { ...body.headers, "x-webhook-token": TEST_WEBHOOK_TOKEN },
        payload: body.payload,
      });
    };

    const first = await send();
    const second = await send();

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ deduped: true, id: first.json<{ id: string }>().id });

    const list = await ctx.app
      .inject({ method: "GET", url: "/api/records", headers: { cookie: ctx.cookie } })
      .then((r) => r.json());
    expect(list.records).toHaveLength(1);

    // The replayed upload must not leave an orphan file behind either.
    expect(fs.readdirSync(path.join(ctx.config.mediaDir, "2026", "09"))).toHaveLength(1);
  });

  it("accepts the token as a query parameter", async () => {
    const body = ringBody({ transcription: "query token delivery" });
    const response = await ctx.app.inject({
      method: "POST",
      url: `/api/webhooks/ring?token=${TEST_WEBHOOK_TOKEN}`,
      headers: body.headers,
      payload: body.payload,
    });
    expect(response.statusCode).toBe(201);
  });

  it("rejects a missing or wrong token", async () => {
    const noToken = await ctx.app.inject({
      method: "POST",
      url: "/api/webhooks/ring",
      ...ringBody(),
    });
    expect(noToken.statusCode).toBe(401);

    const body = ringBody();
    const wrongToken = await ctx.app.inject({
      method: "POST",
      url: "/api/webhooks/ring",
      headers: { ...body.headers, "x-webhook-token": "nope" },
      payload: body.payload,
    });
    expect(wrongToken.statusCode).toBe(401);
  });

  it("rejects a delivery missing required fields", async () => {
    const body = multipart([{ name: "client", value: "ring" }]);
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/webhooks/ring",
      headers: { ...body.headers, "x-webhook-token": TEST_WEBHOOK_TOKEN },
      payload: body.payload,
    });
    expect(response.statusCode).toBe(400);
  });

  it("queues AI work for the record and its day", async () => {
    const body = ringBody();
    await ctx.app.inject({
      method: "POST",
      url: "/api/webhooks/ring",
      headers: { ...body.headers, "x-webhook-token": TEST_WEBHOOK_TOKEN },
      payload: body.payload,
    });

    const kinds = ctx.app.db
      .prepare("SELECT kind, target_id FROM ai_jobs ORDER BY kind")
      .all() as unknown as { kind: string; target_id: string }[];
    expect(kinds.map((k) => k.kind)).toEqual(["day_summary", "record_title"]);
    expect(kinds[0]!.target_id).toBe("2026-09-08");
  });
});
