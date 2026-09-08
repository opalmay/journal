import { useState } from "react";
import { Link } from "react-router";
import { moodColor, moodLabel } from "../lib/mood.js";
import { Button, ErrorNote, Spinner } from "../components/ui.js";
import { useDays } from "../lib/queries.js";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Builds a Monday-first grid for a month, padded with the days that share its
 * first and last weeks so the grid is always rectangular.
 */
export function monthGrid(year: number, month: number): { date: string; inMonth: boolean }[] {
  const first = new Date(Date.UTC(year, month, 1));
  const leading = (first.getUTCDay() + 6) % 7; // Sunday is 0; we want Monday first.
  const cells: { date: string; inMonth: boolean }[] = [];

  const cursor = new Date(first);
  cursor.setUTCDate(cursor.getUTCDate() - leading);
  for (let i = 0; i < 42; i++) {
    const date = `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}`;
    cells.push({ date, inMonth: cursor.getUTCMonth() === month });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (i >= 34 && cursor.getUTCMonth() !== month && cursor.getUTCDay() === 1) break;
  }
  return cells;
}

export function CalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const cells = monthGrid(year, month);
  const from = cells[0]!.date;
  const to = cells[cells.length - 1]!.date;
  const { data: days, isPending, error } = useDays(from, to);
  const byDate = new Map((days ?? []).map((day) => [day.date, day]));
  const today = new Date().toISOString().slice(0, 10);

  const shift = (delta: number) => {
    const next = new Date(Date.UTC(year, month + delta, 1));
    setYear(next.getUTCFullYear());
    setMonth(next.getUTCMonth());
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button onClick={() => shift(-1)}>←</Button>
        <h1 className="text-base font-semibold text-text">
          {new Date(Date.UTC(year, month, 1)).toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })}
        </h1>
        <Button onClick={() => shift(1)}>→</Button>
        <Button
          className="ml-auto"
          onClick={() => {
            setYear(now.getFullYear());
            setMonth(now.getMonth());
          }}
        >
          Today
        </Button>
      </div>

      <ErrorNote error={error} />
      {isPending ? (
        <Spinner />
      ) : (
        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((weekday) => (
            <div key={weekday} className="pb-1 text-center text-[11px] text-overlay0">
              {weekday}
            </div>
          ))}
          {cells.map((cell) => {
            const day = byDate.get(cell.date);
            const mood = day?.mood ?? null;
            return (
              <Link
                key={cell.date}
                to={`/day/${cell.date}`}
                title={`${cell.date} — ${moodLabel(mood)}${day ? `, ${day.recordCount} entries` : ""}`}
                className={`relative flex aspect-square flex-col justify-between rounded-lg border p-1.5 transition-colors ${
                  cell.inMonth
                    ? "border-surface1 hover:border-mauve"
                    : "border-transparent opacity-35"
                } ${cell.date === today ? "ring-1 ring-lavender" : ""}`}
                style={{
                  background: mood ? `color-mix(in oklab, ${moodColor(mood)} 22%, transparent)` : undefined,
                }}
              >
                <span className="text-[11px] tabular-nums text-subtext0">
                  {Number(cell.date.slice(8))}
                </span>
                {day && day.recordCount > 0 && (
                  <span className="self-end text-[10px] font-medium text-overlay1">
                    {day.recordCount}
                  </span>
                )}
                {mood && (
                  <span
                    className="absolute inset-x-1.5 bottom-1 h-0.5 rounded-full"
                    style={{ background: moodColor(mood) }}
                  />
                )}
              </Link>
            );
          })}
        </div>
      )}

      <p className="text-xs text-overlay0">
        Cells are tinted by the day's mood; the number is how many entries it holds.
      </p>
    </div>
  );
}
