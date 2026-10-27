import { useState } from "react";
import { Button, Card, ErrorNote, Spinner } from "./ui.js";
import { useReminders, useTestReminder, useUpdateReminders } from "../lib/queries.js";

// A link styled as a Button: nesting a <button> inside <a> is invalid HTML.
const LINK_BUTTON =
  "inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors";

/**
 * Daily reminder via ntfy. Setup is three taps: subscribe (a ntfy:// link opens
 * the app's subscribe dialog), send a test, confirm it arrived. The server has
 * no way to see subscribers, so that last confirmation is what turns it on.
 */
export function RemindersCard() {
  const { data, isPending, error } = useReminders();
  const update = useUpdateReminders();
  const test = useTestReminder();
  const [copied, setCopied] = useState(false);

  if (isPending) return <Spinner label="Loading reminders" />;
  if (error) return <ErrorNote error={error} />;
  const r = data!;

  const copyTopic = async () => {
    await navigator.clipboard.writeText(r.topic);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const rotate = () => {
    if (!confirm("Make a new topic? Devices subscribed to the old one stop getting reminders.")) return;
    test.reset();
    update.mutate({ kind: "rotate" });
  };

  return (
    <Card className="p-4">
      <h2 className="mb-2 text-sm font-semibold text-mauve">Reminders</h2>

      {r.enabled ? (
        <>
          <p className="text-sm text-subtext0">
            A nudge through ntfy each day at the time below ({r.timeZone}), skipped when you have
            already written something.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="time"
              value={r.time}
              onChange={(e) => {
                if (e.target.value) update.mutate({ kind: "patch", patch: { time: e.target.value } });
              }}
              className="rounded-lg bg-mantle px-3 py-1.5 font-mono text-sm text-text"
            />
            <Button onClick={() => test.mutate()} disabled={test.isPending}>
              {test.isSuccess ? "Sent" : "Send test"}
            </Button>
            <Button
              variant="danger"
              onClick={() => update.mutate({ kind: "patch", patch: { enabled: false } })}
            >
              Turn off
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-subtext0">
            Get a daily nudge on your phone through the ntfy app. Subscribe to this journal's
            private topic, then send a test.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a href={r.links.app} className={`${LINK_BUTTON} bg-mauve text-crust hover:bg-lavender`}>
              Subscribe in ntfy
            </a>
            <a
              href={r.links.web}
              target="_blank"
              rel="noreferrer"
              className={`${LINK_BUTTON} bg-surface0 text-subtext1 hover:bg-surface1 hover:text-text`}
            >
              Open in browser
            </a>
            <Button onClick={() => test.mutate()} disabled={test.isPending}>
              {test.isPending ? "Sending…" : "Send test"}
            </Button>
          </div>
          {test.isSuccess && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-mantle px-3 py-2">
              <span className="text-sm text-text">Did it arrive?</span>
              <Button
                variant="primary"
                onClick={() => update.mutate({ kind: "patch", patch: { enabled: true } })}
              >
                Yes, remind me daily at {r.time}
              </Button>
              <span className="text-xs text-overlay1">
                If not, check the subscription in ntfy and send another.
              </span>
            </div>
          )}
        </>
      )}

      <ErrorNote error={test.error ?? update.error} />

      <details className="mt-3 text-xs text-overlay1">
        <summary className="cursor-pointer">Topic</summary>
        <p className="mt-2">
          Anyone who knows the topic can read these notifications, so treat it like a password.
          They never contain journal text.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg bg-mantle px-3 py-2 font-mono text-sky">
            {r.server}/{r.topic}
          </code>
          <Button onClick={() => void copyTopic()}>{copied ? "Copied" : "Copy"}</Button>
          <Button variant="danger" onClick={rotate}>
            New topic
          </Button>
        </div>
      </details>
    </Card>
  );
}
