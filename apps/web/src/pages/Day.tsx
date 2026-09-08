import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { addDays } from "@journal/shared";
import { Composer } from "../components/Composer.js";
import { RecordCard } from "../components/RecordCard.js";
import { MoodPicker } from "../components/MoodPicker.js";
import { TagInput } from "../components/TagInput.js";
import { Button, Card, EmptyState, ErrorNote, Spinner } from "../components/ui.js";
import { useDay, useRegenerate, useSettings, useTags, useUpdateDay } from "../lib/queries.js";
import { formatDayHeading } from "./Timeline.js";

export function DayPage() {
  const { date = "" } = useParams();
  const day = useDay(date);
  const updateDay = useUpdateDay();
  const regenerate = useRegenerate();
  const { data: settings } = useSettings();
  const { data: knownTags } = useTags();

  const [note, setNote] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);

  // The note is a free-text field the server also writes to; only adopt the
  // server's value while the user is not mid-edit.
  useEffect(() => {
    if (!noteDirty) setNote(day.data?.note ?? "");
  }, [day.data?.note, noteDirty]);

  if (day.isPending) return <Spinner />;
  if (day.error) return <ErrorNote error={day.error} />;
  const data = day.data!;

  const saveNote = () => {
    updateDay.mutate(
      { date, note: note.trim() ? note : null },
      { onSuccess: () => setNoteDirty(false) },
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <nav className="flex items-center justify-between text-sm">
        <Link to={`/day/${addDays(date, -1)}`} className="text-overlay1 hover:text-mauve">
          ← {addDays(date, -1)}
        </Link>
        <Link to="/calendar" className="text-overlay1 hover:text-mauve">
          calendar
        </Link>
        <Link to={`/day/${addDays(date, 1)}`} className="text-overlay1 hover:text-mauve">
          {addDays(date, 1)} →
        </Link>
      </nav>

      <Card className="p-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="text-lg font-semibold text-text">{formatDayHeading(date)}</h1>
          <span className="font-mono text-xs text-overlay0">{date}</span>
          {settings?.aiEnabled && (
            <Button
              className="ml-auto"
              onClick={() => regenerate.mutate({ kind: "day", date })}
              disabled={regenerate.isPending || data.recordCount === 0}
              title="Rewrite the day's title and summary from its entries"
            >
              {regenerate.isPending ? "Queued…" : "↻ Summary"}
            </Button>
          )}
        </div>

        {data.title && <p className="mt-1 text-sm font-medium text-mauve">{data.title}</p>}
        {data.summary && (
          <p className="mt-2 text-sm leading-relaxed text-subtext0">{data.summary}</p>
        )}

        <div className="mt-4 flex flex-col gap-3">
          <MoodPicker
            value={data.mood}
            onChange={(mood) => updateDay.mutate({ date, mood })}
          />
          <TagInput
            value={data.tags}
            onChange={(tags) => updateDay.mutate({ date, tags })}
            suggestions={(knownTags ?? []).map((t) => t.name)}
            placeholder="Tag the day…"
          />
          <div>
            <textarea
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                setNoteDirty(true);
              }}
              rows={3}
              placeholder="A note about the day as a whole…"
              className="w-full resize-y rounded-lg border border-surface1 bg-mantle p-3 text-sm text-text outline-none focus:border-mauve"
            />
            {noteDirty && (
              <Button variant="primary" onClick={saveNote} disabled={updateDay.isPending}>
                {updateDay.isPending ? "Saving…" : "Save note"}
              </Button>
            )}
          </div>
          <ErrorNote error={updateDay.error} />
        </div>
      </Card>

      <Composer defaultDate={date} />

      {data.records.length === 0 ? (
        <EmptyState title="No entries on this day yet." />
      ) : (
        <div className="flex flex-col gap-3">
          {data.records.map((record) => (
            <RecordCard
              key={record.id}
              record={record}
              timeZone={settings?.timeZone ?? "UTC"}
              aiEnabled={settings?.aiEnabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}
