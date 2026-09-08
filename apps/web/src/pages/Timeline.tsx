import { Fragment } from "react";
import { Link } from "react-router";
import type { RecordDTO } from "@journal/shared";
import { Composer } from "../components/Composer.js";
import { RecordCard } from "../components/RecordCard.js";
import { MoodDot } from "../components/MoodPicker.js";
import { Button, Chip, EmptyState, ErrorNote, Spinner } from "../components/ui.js";
import { useDays, useRecordFeed, useSettings } from "../lib/queries.js";

export function formatDayHeading(date: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (date === today) return "Today";
  if (date === yesterday) return "Yesterday";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function groupByDay(records: RecordDTO[]): [string, RecordDTO[]][] {
  const groups = new Map<string, RecordDTO[]>();
  for (const record of records) {
    const list = groups.get(record.dayDate) ?? [];
    list.push(record);
    groups.set(record.dayDate, list);
  }
  return [...groups.entries()];
}

export function TimelinePage() {
  const feed = useRecordFeed({ limit: 50 });
  const { data: settings } = useSettings();
  const timeZone = settings?.timeZone ?? "UTC";

  const records = feed.data?.pages.flatMap((page) => page.records) ?? [];
  const groups = groupByDay(records);

  // Day headings show the day's own mood and AI title, which live on the day
  // rows rather than the records — fetch just the span the feed has loaded.
  const dates = groups.map(([date]) => date);
  const to = dates[0] ?? new Date().toISOString().slice(0, 10);
  const from = dates[dates.length - 1] ?? to;
  const { data: days } = useDays(from, to);
  const dayByDate = new Map((days ?? []).map((day) => [day.date, day]));

  return (
    <div className="flex flex-col gap-6">
      <Composer />
      <ErrorNote error={feed.error} />

      {feed.isPending ? (
        <Spinner />
      ) : groups.length === 0 ? (
        <EmptyState
          title="Nothing recorded yet."
          hint="Write an entry above, or let the ring file one for you."
        />
      ) : (
        groups.map(([date, dayRecords]) => (
          <Fragment key={date}>
            <div className="flex items-center gap-2 pt-2">
              <MoodDot mood={dayByDate.get(date)?.mood ?? null} />
              <Link
                to={`/day/${date}`}
                className="text-sm font-semibold text-subtext1 hover:text-mauve"
              >
                {formatDayHeading(date)}
              </Link>
              {dayByDate.get(date)?.title && (
                <span className="truncate text-sm text-overlay1">
                  {dayByDate.get(date)!.title}
                </span>
              )}
              <Chip>{dayRecords.length}</Chip>
              <span className="h-px flex-1 bg-surface1" />
            </div>
            <div className="flex flex-col gap-3">
              {dayRecords.map((record) => (
                <RecordCard
                  key={record.id}
                  record={record}
                  timeZone={timeZone}
                  aiEnabled={settings?.aiEnabled}
                />
              ))}
            </div>
          </Fragment>
        ))
      )}

      {feed.hasNextPage && (
        <Button onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
          {feed.isFetchingNextPage ? "Loading…" : "Load older entries"}
        </Button>
      )}
    </div>
  );
}
