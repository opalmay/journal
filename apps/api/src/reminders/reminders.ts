import { randomBytes } from "node:crypto";
import { dateKeyFromTimestamp, timeOfDay } from "@journal/shared";
import type { Db } from "../db/index.js";
import type { Notification, Notifier } from "./ntfy.js";

export const REMINDER_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const TICK_INTERVAL_MS = 60_000;

export interface ReminderSettings {
  topic: string;
  enabled: boolean;
  time: string;
  appUrl: string | null;
  doneForDate: string | null;
}

interface ReminderRow {
  ntfy_topic: string;
  enabled: number;
  time: string;
  app_url: string | null;
  done_for_date: string | null;
}

/** 128 random bits in ntfy's topic alphabet. Anyone holding it can subscribe. */
export function newTopic(): string {
  return `journal-${randomBytes(16).toString("base64url")}`;
}

export function getReminderSettings(db: Db): ReminderSettings {
  const select = db.prepare("SELECT * FROM reminder_settings WHERE id = 1");
  let row = select.get() as unknown as ReminderRow | undefined;
  if (!row) {
    db.prepare("INSERT INTO reminder_settings (id, ntfy_topic, updated_at) VALUES (1, ?, ?)").run(
      newTopic(),
      Date.now(),
    );
    row = select.get() as unknown as ReminderRow;
  }
  return {
    topic: row.ntfy_topic,
    enabled: row.enabled === 1,
    time: row.time,
    appUrl: row.app_url,
    doneForDate: row.done_for_date,
  };
}

function writeReminderSettings(db: Db, s: ReminderSettings, now = Date.now()): void {
  db.prepare(
    `UPDATE reminder_settings
     SET ntfy_topic = ?, enabled = ?, time = ?, app_url = ?, done_for_date = ?, updated_at = ?
     WHERE id = 1`,
  ).run(s.topic, s.enabled ? 1 : 0, s.time, s.appUrl, s.doneForDate, now);
}

export interface ReminderPatch {
  enabled?: boolean;
  time?: string;
  topic?: string;
  appUrl?: string;
}

export function updateReminderSettings(
  db: Db,
  patch: ReminderPatch,
  timeZone: string,
  now = Date.now(),
): ReminderSettings {
  const current = getReminderSettings(db);
  const next: ReminderSettings = {
    topic: patch.topic ?? current.topic,
    enabled: patch.enabled ?? current.enabled,
    time: patch.time ?? current.time,
    appUrl: patch.appUrl ?? current.appUrl,
    doneForDate: current.doneForDate,
  };
  // Turning reminders on, or moving the time, at 22:00 for a 21:00 reminder
  // should not fire one immediately: today counts as handled. Before the time,
  // today is open again.
  if (patch.enabled !== undefined || patch.time !== undefined) {
    next.doneForDate = timeOfDay(now, timeZone) >= next.time ? dateKeyFromTimestamp(now, timeZone) : null;
  }
  writeReminderSettings(db, next, now);
  return next;
}

function hasRecordsOn(db: Db, date: string): boolean {
  return db.prepare("SELECT 1 FROM records WHERE day_date = ? LIMIT 1").get(date) !== undefined;
}

function dailyReminder(appUrl: string | null): Notification {
  return {
    title: "Journal",
    message: "Nothing written today yet. A line or two before the day ends?",
    tags: ["notebook"],
    click: appUrl ?? undefined,
  };
}

export interface ReminderLogger {
  error(obj: unknown, msg?: string): void;
}

export type TickResult = "idle" | "sent" | "skipped" | "failed";

/**
 * Fires the daily reminder once the configured local time has passed, unless
 * something was already written that day. `done_for_date` is set before the
 * send so a slow ntfy call cannot double-fire, and cleared again on failure
 * so the next minute's tick retries.
 */
export class ReminderScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: Db,
    private readonly timeZone: string,
    private readonly notifier: Notifier,
    private readonly log: ReminderLogger,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(now = Date.now()): Promise<TickResult> {
    if (this.running) return "idle";
    this.running = true;
    try {
      const settings = getReminderSettings(this.db);
      if (!settings.enabled) return "idle";
      const today = dateKeyFromTimestamp(now, this.timeZone);
      if (settings.doneForDate === today) return "idle";
      if (timeOfDay(now, this.timeZone) < settings.time) return "idle";

      writeReminderSettings(this.db, { ...settings, doneForDate: today }, now);
      if (hasRecordsOn(this.db, today)) return "skipped";

      try {
        await this.notifier.send(settings.topic, dailyReminder(settings.appUrl));
        return "sent";
      } catch (err) {
        this.log.error({ err }, "reminder send failed");
        writeReminderSettings(this.db, settings, now);
        return "failed";
      }
    } finally {
      this.running = false;
    }
  }
}
