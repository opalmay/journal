import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { subscribeLinks } from "../reminders/ntfy.js";
import {
  REMINDER_TIME_RE,
  getReminderSettings,
  newTopic,
  updateReminderSettings,
  type ReminderSettings,
} from "../reminders/reminders.js";

const ReminderInput = z
  .object({
    enabled: z.boolean().optional(),
    time: z.string().regex(REMINDER_TIME_RE).optional(),
  })
  .strict();

/** The origin the user reached us on — what a tapped notification should open. */
function appUrlOf(request: FastifyRequest): string {
  return `${request.protocol}://${request.host}/`;
}

export async function registerReminderRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app;

  const view = (s: ReminderSettings) => ({
    enabled: s.enabled,
    time: s.time,
    timeZone: config.JOURNAL_TZ,
    server: config.ntfyUrl,
    topic: s.topic,
    links: subscribeLinks(config.ntfyUrl, s.topic),
  });

  app.get("/api/reminders", async () => view(getReminderSettings(db)));

  app.patch("/api/reminders", async (request) => {
    const patch = ReminderInput.parse(request.body);
    return view(
      updateReminderSettings(db, { ...patch, appUrl: appUrlOf(request) }, config.JOURNAL_TZ),
    );
  });

  app.post(
    "/api/reminders/test",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const appUrl = appUrlOf(request);
      const s = updateReminderSettings(db, { appUrl }, config.JOURNAL_TZ);
      try {
        await app.notifier.send(s.topic, {
          title: "Journal",
          message: "Test notification. Reminders can reach this device.",
          tags: ["white_check_mark"],
          click: appUrl,
        });
      } catch (err) {
        request.log.error({ err }, "ntfy test failed");
        return reply.code(502).send({ error: "ntfy_unreachable" });
      }
      return { sent: true };
    },
  );

  // For a leaked link: the old topic stops receiving, and reminders stay off
  // until the new one is subscribed and confirmed.
  app.post("/api/reminders/topic", async () =>
    view(updateReminderSettings(db, { topic: newTopic(), enabled: false }, config.JOURNAL_TZ)),
  );
}
