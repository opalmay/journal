import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeContext, type TestContext } from "./helpers.js";
import {
  ReminderScheduler,
  getReminderSettings,
  updateReminderSettings,
} from "../src/reminders/reminders.js";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { NtfyNotifier, subscribeLinks } from "../src/reminders/ntfy.js";

const silent = { error() {} };

// 2026-09-08 is CEST (UTC+2): 19:00Z is 21:00 in Berlin.
const at = (iso: string) => Date.parse(iso);
const BEFORE = at("2026-09-08T18:59:00Z");
const AFTER = at("2026-09-08T19:00:00Z");
const NEXT_DAY_AFTER = at("2026-09-09T19:05:00Z");

describe("reminders", () => {
  let ctx: TestContext;
  let scheduler: ReminderScheduler;
  const auth = () => ({ cookie: ctx.cookie });
  const enable = (now = at("2026-09-08T08:00:00Z")) =>
    updateReminderSettings(ctx.app.db, { enabled: true, time: "21:00" }, "Europe/Berlin", now);

  beforeEach(async () => {
    ctx = await makeContext();
    scheduler = new ReminderScheduler(ctx.app.db, "Europe/Berlin", ctx.notifier, silent);
  });
  afterEach(async () => {
    await ctx.close();
  });

  it("generates an unguessable topic once and keeps it", () => {
    const first = getReminderSettings(ctx.app.db);
    expect(first.topic).toMatch(/^journal-[A-Za-z0-9_-]{22}$/);
    expect(first.enabled).toBe(false);
    expect(getReminderSettings(ctx.app.db).topic).toBe(first.topic);
  });

  it("does nothing while disabled", async () => {
    expect(await scheduler.tick(AFTER)).toBe("idle");
    expect(ctx.notifier.sent).toHaveLength(0);
  });

  it("fires once after the local time, then again the next day", async () => {
    enable();
    expect(await scheduler.tick(BEFORE)).toBe("idle");
    expect(await scheduler.tick(AFTER)).toBe("sent");
    expect(await scheduler.tick(AFTER + 60_000)).toBe("idle");
    expect(await scheduler.tick(NEXT_DAY_AFTER)).toBe("sent");

    expect(ctx.notifier.sent).toHaveLength(2);
    expect(ctx.notifier.sent[0]!.topic).toBe(getReminderSettings(ctx.app.db).topic);
  });

  it("skips a day that already has an entry", async () => {
    enable();
    await ctx.app.inject({
      method: "POST",
      url: "/api/records",
      headers: auth(),
      payload: { text: "walked the dog", timestamp: at("2026-09-08T07:00:00Z") },
    });
    expect(await scheduler.tick(AFTER)).toBe("skipped");
    expect(await scheduler.tick(AFTER + 60_000)).toBe("idle");
    expect(ctx.notifier.sent).toHaveLength(0);
  });

  it("does not fire immediately when enabled after today's time", async () => {
    enable(at("2026-09-08T20:00:00Z"));
    expect(await scheduler.tick(at("2026-09-08T20:01:00Z"))).toBe("idle");
    expect(await scheduler.tick(NEXT_DAY_AFTER)).toBe("sent");
  });

  it("retries on the next tick when ntfy fails", async () => {
    enable();
    ctx.notifier.fail = true;
    expect(await scheduler.tick(AFTER)).toBe("failed");
    ctx.notifier.fail = false;
    expect(await scheduler.tick(AFTER + 60_000)).toBe("sent");
  });

  it("serves settings, sends a test and records where to open the app", async () => {
    const get = await ctx.app.inject({ method: "GET", url: "/api/reminders", headers: auth() });
    const view = get.json();
    expect(view.links.web).toBe(`https://ntfy.sh/${view.topic}`);
    expect(view.links.app).toBe(`ntfy://ntfy.sh/${view.topic}`);

    const test = await ctx.app.inject({
      method: "POST",
      url: "/api/reminders/test",
      headers: { ...auth(), host: "journal.example", "x-forwarded-proto": "https" },
    });
    expect(test.statusCode).toBe(200);
    expect(ctx.notifier.sent[0]!.notification.click).toBe("https://journal.example/");
    expect(getReminderSettings(ctx.app.db).appUrl).toBe("https://journal.example/");

    ctx.notifier.fail = true;
    const failed = await ctx.app.inject({ method: "POST", url: "/api/reminders/test", headers: auth() });
    expect(failed.statusCode).toBe(502);
  });

  it("validates the time and rotates the topic", async () => {
    const bad = await ctx.app.inject({
      method: "PATCH",
      url: "/api/reminders",
      headers: auth(),
      payload: { time: "25:00" },
    });
    expect(bad.statusCode).toBe(400);

    const on = await ctx.app.inject({
      method: "PATCH",
      url: "/api/reminders",
      headers: auth(),
      payload: { enabled: true, time: "07:30" },
    });
    expect(on.json()).toMatchObject({ enabled: true, time: "07:30" });

    const before = getReminderSettings(ctx.app.db).topic;
    const rotated = await ctx.app.inject({ method: "POST", url: "/api/reminders/topic", headers: auth() });
    expect(rotated.json().topic).not.toBe(before);
    expect(rotated.json().enabled).toBe(false);
  });

  it("needs a session", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/reminders" });
    expect(res.statusCode).toBe(401);
  });
});

describe("subscribeLinks", () => {
  it("marks a plain-http server as insecure for the app", () => {
    expect(subscribeLinks("http://ntfy.local:8080", "t")).toEqual({
      app: "ntfy://ntfy.local:8080/t?secure=false",
      web: "http://ntfy.local:8080/t",
    });
  });
});

describe("NtfyNotifier", () => {
  it("publishes the message as the body and metadata as headers", async () => {
    const received: { url?: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push({ url: req.url, headers: req.headers, body });
        res.statusCode = req.url === "/broken" ? 500 : 200;
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const notifier = new NtfyNotifier(`http://127.0.0.1:${port}`, "tk_secret");

    try {
      await notifier.send("journal-abc", {
        title: "Journal",
        message: "hello",
        tags: ["notebook"],
        click: "https://journal.example/",
      });
      expect(received[0]).toMatchObject({
        url: "/journal-abc",
        body: "hello",
        headers: {
          title: "Journal",
          tags: "notebook",
          click: "https://journal.example/",
          authorization: "Bearer tk_secret",
        },
      });
      await expect(notifier.send("broken", { title: "t", message: "m" })).rejects.toThrow(/500/);
    } finally {
      server.close();
    }
  });
});
