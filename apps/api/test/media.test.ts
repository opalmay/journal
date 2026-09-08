import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeContext, multipart, type TestContext } from "./helpers.js";
import { parseRange } from "../src/routes/media.js";

const CONTENT = Buffer.from("0123456789abcdefghij"); // 20 bytes

describe("parseRange", () => {
  it("reads a closed range", () => {
    expect(parseRange("bytes=0-9", 20)).toEqual({ start: 0, end: 9 });
  });
  it("reads an open-ended range", () => {
    expect(parseRange("bytes=5-", 20)).toEqual({ start: 5, end: 19 });
  });
  it("reads a suffix range", () => {
    expect(parseRange("bytes=-5", 20)).toEqual({ start: 15, end: 19 });
  });
  it("clamps an end past the file", () => {
    expect(parseRange("bytes=10-999", 20)).toEqual({ start: 10, end: 19 });
  });
  it("reports an unsatisfiable range", () => {
    expect(parseRange("bytes=25-30", 20)).toBe("unsatisfiable");
  });
  it("ignores absent or malformed headers", () => {
    expect(parseRange(undefined, 20)).toBeNull();
    expect(parseRange("items=1-2", 20)).toBeNull();
    expect(parseRange("bytes=-", 20)).toBeNull();
  });
});

describe("GET /api/media/:id", () => {
  let ctx: TestContext;
  let mediaId: string;
  const auth = () => ({ cookie: ctx.cookie });

  beforeEach(async () => {
    ctx = await makeContext();
    const body = multipart(
      [{ name: "text", value: "a recording" }],
      [{ name: "audio", filename: "clip.m4a", contentType: "audio/mp4", content: CONTENT }],
    );
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/records",
      headers: { ...body.headers, ...auth() },
      payload: body.payload,
    });
    mediaId = created.json().media[0].id;
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("serves the whole file with a byte-range offer", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/media/${mediaId}`,
      headers: auth(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("audio/mp4");
    expect(response.headers["accept-ranges"]).toBe("bytes");
    expect(response.rawPayload.equals(CONTENT)).toBe(true);
  });

  it("serves a partial range so audio can seek", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/media/${mediaId}`,
      headers: { ...auth(), range: "bytes=5-9" },
    });
    expect(response.statusCode).toBe(206);
    expect(response.headers["content-range"]).toBe(`bytes 5-9/${CONTENT.length}`);
    expect(response.headers["content-length"]).toBe("5");
    expect(response.rawPayload.toString()).toBe("56789");
  });

  it("answers an unsatisfiable range with 416", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/media/${mediaId}`,
      headers: { ...auth(), range: "bytes=999-1000" },
    });
    expect(response.statusCode).toBe(416);
    expect(response.headers["content-range"]).toBe(`bytes */${CONTENT.length}`);
  });

  it("requires a session", async () => {
    const response = await ctx.app.inject({ method: "GET", url: `/api/media/${mediaId}` });
    expect(response.statusCode).toBe(401);
  });

  it("404s an unknown id", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/media/00000000-0000-0000-0000-000000000000",
      headers: auth(),
    });
    expect(response.statusCode).toBe(404);
  });
});
