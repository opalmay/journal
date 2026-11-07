import { describe, expect, it } from "vitest";
import { makeContext } from "./helpers.js";

describe("GET /api/health", () => {
  it("answers without a session", async () => {
    const ctx = await makeContext();
    try {
      const res = await ctx.app.inject({ method: "GET", url: "/api/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, commit: null, builtAt: null });
    } finally {
      await ctx.close();
    }
  });

  it("reports the commit stamped into the build", async () => {
    const ctx = await makeContext({ GIT_SHA: "0e0c339", BUILT_AT: "2026-11-07T09:00:00Z" });
    try {
      const res = await ctx.app.inject({ method: "GET", url: "/api/health" });
      expect(res.json()).toMatchObject({
        ok: true,
        commit: "0e0c339",
        builtAt: "2026-11-07T09:00:00Z",
      });
    } finally {
      await ctx.close();
    }
  });
});
