import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeContext, type TestContext } from "./helpers.js";

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "a-code-verifier-that-is-long-enough-for-pkce-0123456789";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

const form = (fields: Record<string, string>) => ({
  payload: new URLSearchParams(fields).toString(),
  headers: { "content-type": "application/x-www-form-urlencoded" },
});

async function register(ctx: TestContext): Promise<string> {
  const response = await ctx.app.inject({
    method: "POST",
    url: "/oauth/register",
    payload: { client_name: "Claude", redirect_uris: [REDIRECT] },
  });
  expect(response.statusCode).toBe(201);
  return response.json().client_id as string;
}

function authorizeQuery(clientId: string, extra: Record<string, string> = {}) {
  return {
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "xyz",
    ...extra,
  };
}

/** Walks the consent page as the logged-in user and returns the code. */
async function authorize(ctx: TestContext, clientId: string): Promise<string> {
  const query = authorizeQuery(clientId);
  const pageResponse = await ctx.app.inject({
    method: "GET",
    url: `/oauth/authorize?${new URLSearchParams(query)}`,
    headers: { cookie: ctx.cookie },
  });
  expect(pageResponse.statusCode).toBe(200);
  const csrf = /name="csrf" value="([^"]+)"/.exec(pageResponse.body)![1]!;

  const approve = await ctx.app.inject({
    method: "POST",
    url: "/oauth/authorize",
    headers: { cookie: ctx.cookie, ...form({}).headers },
    payload: new URLSearchParams({ ...query, csrf, decision: "allow" }).toString(),
  });
  expect(approve.statusCode).toBe(302);
  const location = new URL(approve.headers.location as string);
  expect(location.origin + location.pathname).toBe(REDIRECT);
  expect(location.searchParams.get("state")).toBe("xyz");
  return location.searchParams.get("code")!;
}

async function exchange(ctx: TestContext, clientId: string, code: string, verifier = VERIFIER) {
  return ctx.app.inject({
    method: "POST",
    url: "/oauth/token",
    ...form({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
      client_id: clientId,
    }),
  });
}

async function connect(ctx: TestContext): Promise<{ clientId: string; access: string; refresh: string }> {
  const clientId = await register(ctx);
  const tokens = (await exchange(ctx, clientId, await authorize(ctx, clientId))).json();
  return { clientId, access: tokens.access_token, refresh: tokens.refresh_token };
}

let rpcId = 0;
async function rpc(ctx: TestContext, token: string, method: string, params: unknown = {}) {
  return ctx.app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    payload: { jsonrpc: "2.0", id: ++rpcId, method, params },
  });
}

async function callTool(ctx: TestContext, token: string, name: string, args: unknown) {
  const response = await rpc(ctx, token, "tools/call", { name, arguments: args });
  expect(response.statusCode).toBe(200);
  const result = response.json().result;
  const text = result.content[0].text as string;
  return { isError: result.isError === true, text, data: result.isError ? null : JSON.parse(text) };
}

describe("OAuth for /mcp", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await makeContext();
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("rejects /mcp without a token and points at the metadata", async () => {
    const response = await ctx.app.inject({ method: "POST", url: "/mcp", payload: {} });
    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toContain(
      'resource_metadata="http://localhost:80/.well-known/oauth-protected-resource/mcp"',
    );
    const meta = await ctx.app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server" });
    expect(meta.json().code_challenge_methods_supported).toEqual(["S256"]);
  });

  it("sends a logged-out user to the login page first", async () => {
    const clientId = await register(ctx);
    const response = await ctx.app.inject({
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams(authorizeQuery(clientId))}`,
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toMatch(/^\/login\?next=%2Foauth%2Fauthorize/);
  });

  it("refuses a redirect_uri the client did not register", async () => {
    const clientId = await register(ctx);
    const response = await ctx.app.inject({
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams(authorizeQuery(clientId, { redirect_uri: "https://evil.example/cb" }))}`,
      headers: { cookie: ctx.cookie },
    });
    expect(response.statusCode).toBe(400);
  });

  it("refuses a consent post without the session's csrf token", async () => {
    const clientId = await register(ctx);
    const response = await ctx.app.inject({
      method: "POST",
      url: "/oauth/authorize",
      headers: { cookie: ctx.cookie, ...form({}).headers },
      payload: new URLSearchParams({ ...authorizeQuery(clientId), csrf: "nope", decision: "allow" }).toString(),
    });
    expect(response.statusCode).toBe(400);
  });

  it("issues tokens for a code once, and only with the right verifier", async () => {
    const clientId = await register(ctx);
    const wrong = await exchange(ctx, clientId, await authorize(ctx, clientId), `${VERIFIER}-wrong`);
    expect(wrong.statusCode).toBe(400);

    const code = await authorize(ctx, clientId);
    const first = await exchange(ctx, clientId, code);
    expect(first.statusCode).toBe(200);
    expect(first.json().token_type).toBe("Bearer");
    expect((await exchange(ctx, clientId, code)).statusCode).toBe(400);

    const list = await rpc(ctx, first.json().access_token, "tools/list");
    expect(list.json().result.tools.map((t: { name: string }) => t.name).sort()).toEqual([
      "get_daily_series",
      "get_entries",
      "search_entries",
    ]);
  });

  it("rotates refresh tokens and stops working once revoked", async () => {
    const { clientId, access, refresh } = await connect(ctx);
    const refreshWith = (token: string) =>
      ctx.app.inject({
        method: "POST",
        url: "/oauth/token",
        ...form({ grant_type: "refresh_token", refresh_token: token, client_id: clientId }),
      });

    const rotated = await refreshWith(refresh);
    expect(rotated.statusCode).toBe(200);
    expect((await refreshWith(refresh)).statusCode).toBe(400);
    expect((await rpc(ctx, access, "tools/list")).statusCode).toBe(401);

    const settings = await ctx.app.inject({ method: "GET", url: "/api/settings", headers: { cookie: ctx.cookie } });
    expect(settings.json().connectedApps).toEqual([{ id: clientId, name: "Claude" }]);

    const revoke = await ctx.app.inject({
      method: "DELETE",
      url: `/api/oauth/clients/${clientId}`,
      headers: { cookie: ctx.cookie },
    });
    expect(revoke.statusCode).toBe(204);
    expect((await rpc(ctx, rotated.json().access_token, "tools/list")).statusCode).toBe(401);
  });
});

describe("MCP tools", () => {
  let ctx: TestContext;
  let token: string;

  async function addRecord(text: string, at: string, tags: string[] = []) {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/records",
      headers: { cookie: ctx.cookie },
      payload: { text, tags, timestamp: Date.parse(at) },
    });
    expect(response.statusCode).toBe(201);
  }

  async function patchDay(date: string, patch: unknown) {
    const response = await ctx.app.inject({
      method: "PATCH",
      url: `/api/days/${date}`,
      headers: { cookie: ctx.cookie },
      payload: patch,
    });
    expect(response.statusCode).toBe(200);
  }

  beforeEach(async () => {
    ctx = await makeContext();
    token = (await connect(ctx)).access;
    await addRecord("walked by the river, felt good", "2026-09-08T08:15:00Z", ["walk"]);
    await addRecord("slept badly again", "2026-09-10T06:00:00Z");
    await patchDay("2026-09-08", {
      mood: 4,
      tags: ["holiday"],
      metrics: { energy: 3, sleepHours: 7.5, napTimes: "13:00–14:00", cycleDay: 12 },
    });
    await patchDay("2026-09-10", { mood: 2, metrics: { sleepHours: 5 } });
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("get_entries returns days oldest first with their entries", async () => {
    const { data } = await callTool(ctx, token, "get_entries", { from: "2026-09-01", to: "2026-09-30" });
    expect(data.days.map((d: { date: string }) => d.date)).toEqual(["2026-09-08", "2026-09-10"]);
    const day = data.days[0];
    expect(day).toMatchObject({ mood: 4, energy: 3, tags: ["holiday"] });
    expect(day.sleep).toMatchObject({ hours: 7.5, napTimes: "13:00–14:00" });
    expect(day.entries).toEqual([
      { time: "10:15", title: null, text: "walked by the river, felt good", tags: ["walk"] },
    ]);
  });

  it("get_entries refuses an oversized range", async () => {
    const result = await callTool(ctx, token, "get_entries", { from: "2026-01-01", to: "2026-12-31" });
    expect(result.isError).toBe(true);
  });

  it("get_daily_series fills gaps with null", async () => {
    const { data } = await callTool(ctx, token, "get_daily_series", {
      from: "2026-09-08",
      to: "2026-09-10",
      fields: ["mood", "sleepHours"],
    });
    expect(data).toEqual({
      dates: ["2026-09-08", "2026-09-09", "2026-09-10"],
      series: { mood: [4, null, 2], sleepHours: [7.5, null, 5] },
    });
  });

  it("get_daily_series only offers cycleDay when cycle tracking is on", async () => {
    const args = { from: "2026-09-08", to: "2026-09-08", fields: ["cycleDay"] };
    const off = await rpc(ctx, token, "tools/call", { name: "get_daily_series", arguments: args });
    expect(off.json().result?.isError ?? Boolean(off.json().error)).toBe(true);

    await ctx.app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { cookie: ctx.cookie },
      payload: { trackCycle: true },
    });
    const { data } = await callTool(ctx, token, "get_daily_series", args);
    expect(data.series.cycleDay).toEqual([12]);
  });

  it("search_entries matches keywords, and tags on entries and days", async () => {
    const keyword = await callTool(ctx, token, "search_entries", { query: "river" });
    expect(keyword.data.entries.map((e: { date: string }) => e.date)).toEqual(["2026-09-08"]);
    expect(keyword.data.days).toBeUndefined();

    const dayTag = await callTool(ctx, token, "search_entries", { query: "#holiday" });
    expect(dayTag.data.entries).toEqual([]);
    expect(dayTag.data.days.map((d: { date: string }) => d.date)).toEqual(["2026-09-08"]);

    const recordTag = await callTool(ctx, token, "search_entries", { query: "walk" });
    expect(recordTag.data.entries).toHaveLength(1);
    expect(recordTag.data.entries[0].tags).toEqual(["walk"]);
  });
});
