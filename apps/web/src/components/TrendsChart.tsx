import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Link } from "react-router";
import { addDays, type DayDTO } from "@journal/shared";
import { metricChip } from "../lib/metrics.js";
import { moodColor } from "../lib/mood.js";
import { dateRange, rollingMean, weekStart } from "../lib/trends.js";
import { useDays } from "../lib/queries.js";
import { Chip, ErrorNote, Spinner } from "./ui.js";

const RANGES = [
  { label: "3M", days: 91 },
  { label: "6M", days: 182 },
  { label: "1Y", days: 365 },
] as const;

const MOOD = "var(--color-mauve)";
const ENERGY = "var(--color-peach)";
const SLEEP = "var(--color-sapphire)";

/** Rolling-mean window, and how many days in it must have a value to draw a point. */
const WINDOW = 7;
const MIN_COUNT = 3;
const SLEEP_MAX = 12;

/** Mood and energy over months, with sleep on request: a heatmap strip above a smoothed line chart. */
export function TrendsChart() {
  const [range, setRange] = useState<number>(182);
  const [showSleep, setShowSleep] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const to = new Date().toISOString().slice(0, 10);
  const from = addDays(to, -(range - 1));
  const { data: days, isPending, error } = useDays(from, to);
  const byDate = new Map((days ?? []).map((day) => [day.date, day]));
  const dates = dateRange(from, to);
  const selectedDay = selected ? byDate.get(selected) : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {RANGES.map((r) => (
          <Chip key={r.label} active={range === r.days} onClick={() => setRange(r.days)}>
            {r.label}
          </Chip>
        ))}
        <span className="ml-auto flex items-center gap-3 text-xs text-subtext0">
          <Swatch color={MOOD} label="mood" />
          <Swatch color={ENERGY} label="energy" />
          <Chip active={showSleep} onClick={() => setShowSleep(!showSleep)}>
            sleep
          </Chip>
        </span>
      </div>

      <ErrorNote error={error} />
      {isPending ? (
        <Spinner />
      ) : (
        <>
          <Heatmap dates={dates} byDate={byDate} selected={selected} onSelect={setSelected} />
          <div className="flex h-5 items-center gap-2 text-xs text-subtext0">
            {selected ? (
              <>
                <span className="shrink-0 font-medium text-subtext1">{shortDate(selected)}</span>
                <span className="truncate">{readout(selectedDay)}</span>
                <Link to={`/day/${selected}`} className="ml-auto shrink-0 text-mauve hover:text-lavender">
                  Open day →
                </Link>
              </>
            ) : (
              <span className="text-overlay0">
                Tap a day for its values. Lines are {WINDOW}-day averages.
              </span>
            )}
          </div>
          <LineChart
            dates={dates}
            byDate={byDate}
            showSleep={showSleep}
            selected={selected}
            onSelect={setSelected}
          />
        </>
      )}
    </div>
  );
}

function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function readout(day: DayDTO | undefined): string {
  if (!day) return "nothing recorded";
  const parts = [
    day.mood !== null && metricChip("mood", day.mood),
    day.metrics.energy !== null && metricChip("energy", day.metrics.energy),
    day.metrics.sleepHours !== null && metricChip("sleepHours", day.metrics.sleepHours),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "no mood, energy or sleep";
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="h-0.5 w-3 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

type ChartProps = {
  dates: string[];
  byDate: Map<string, DayDTO>;
  selected: string | null;
  onSelect: (date: string) => void;
};

const CELL = 10;
const GAP = 2;

/** One column per week, Monday at the top, each day tinted by its mood like the month grid. */
function Heatmap({ dates, byDate, selected, onSelect }: ChartProps) {
  const leading = dateRange(weekStart(dates[0]!), dates[0]!).length - 1;
  const columns = Math.ceil((leading + dates.length) / 7);
  const width = columns * (CELL + GAP) - GAP;
  const height = 7 * (CELL + GAP) - GAP;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
      style={{ maxWidth: columns * 16 }}
      role="img"
      aria-label="Mood heatmap"
    >
      {dates.map((date, i) => {
        const offset = leading + i;
        const mood = byDate.get(date)?.mood ?? null;
        return (
          <rect
            key={date}
            x={Math.floor(offset / 7) * (CELL + GAP)}
            y={(offset % 7) * (CELL + GAP)}
            width={CELL}
            height={CELL}
            rx={2}
            onClick={() => onSelect(date)}
            className="cursor-pointer"
            style={{
              fill: mood
                ? `color-mix(in oklab, ${moodColor(mood)} 70%, var(--color-base))`
                : "var(--color-surface0)",
              stroke: date === selected ? "var(--color-lavender)" : "none",
              strokeWidth: 1.5,
            }}
          >
            <title>{date}</title>
          </rect>
        );
      })}
    </svg>
  );
}

/** Width of an element in CSS pixels, so chart text stays a readable size at any width. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const HEIGHT = 200;
const PAD = { top: 8, right: 28, bottom: 20, left: 20 };

function LineChart({ dates, byDate, showSleep, selected, onSelect }: ChartProps & { showSleep: boolean }) {
  const [ref, width] = useWidth();
  const innerW = Math.max(width - PAD.left - PAD.right, 1);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const step = innerW / Math.max(dates.length - 1, 1);
  const x = (i: number) => PAD.left + i * step;
  const yScore = (v: number) => PAD.top + ((5 - v) / 4) * innerH;
  const ySleep = (v: number) => PAD.top + ((SLEEP_MAX - Math.min(v, SLEEP_MAX)) / SLEEP_MAX) * innerH;

  const mood = dates.map((d) => byDate.get(d)?.mood ?? null);
  const energy = dates.map((d) => byDate.get(d)?.metrics.energy ?? null);
  const sleep = dates.map((d) => byDate.get(d)?.metrics.sleepHours ?? null);

  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const left = event.currentTarget.getBoundingClientRect().left;
    const i = Math.round((event.clientX - left - PAD.left) / step);
    onSelect(dates[Math.min(Math.max(i, 0), dates.length - 1)]!);
  };

  const selectedIndex = selected ? dates.indexOf(selected) : -1;
  const months = dates.flatMap((d, i) => (d.endsWith("-01") ? [{ d, i }] : []));

  return (
    <div ref={ref} className="w-full">
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          onPointerDown={pick}
          onPointerMove={(e) => e.pointerType === "mouse" && pick(e)}
          style={{ touchAction: "pan-y" }}
          className="cursor-crosshair select-none"
          role="img"
          aria-label="Mood and energy over time"
        >
          {[1, 2, 3, 4, 5].map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={PAD.left + innerW}
                y1={yScore(v)}
                y2={yScore(v)}
                stroke="var(--color-surface1)"
                strokeWidth={0.5}
              />
              <text x={PAD.left - 6} y={yScore(v) + 3} textAnchor="end" fontSize={10} fill="var(--color-overlay0)">
                {v}
              </text>
            </g>
          ))}
          {showSleep &&
            [0, 6, 12].map((h) => (
              <text
                key={h}
                x={PAD.left + innerW + 6}
                y={ySleep(h) + 3}
                fontSize={10}
                fill={SLEEP}
              >
                {h}h
              </text>
            ))}
          {months.map(({ d, i }) => (
            <g key={d}>
              <line
                x1={x(i)}
                x2={x(i)}
                y1={PAD.top}
                y2={PAD.top + innerH}
                stroke="var(--color-surface0)"
                strokeWidth={1}
              />
              <text x={x(i) + 3} y={HEIGHT - 6} fontSize={10} fill="var(--color-overlay0)">
                {new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, {
                  month: "short",
                  ...(d.slice(5, 7) === "01" ? { year: "2-digit" } : {}),
                  timeZone: "UTC",
                })}
              </text>
            </g>
          ))}

          <Dots values={mood} x={x} y={yScore} color={MOOD} />
          <Dots values={energy} x={x} y={yScore} color={ENERGY} />
          {showSleep && <Line values={rollingMean(sleep, WINDOW, MIN_COUNT)} x={x} y={ySleep} color={SLEEP} dashed />}
          <Line values={rollingMean(energy, WINDOW, MIN_COUNT)} x={x} y={yScore} color={ENERGY} />
          <Line values={rollingMean(mood, WINDOW, MIN_COUNT)} x={x} y={yScore} color={MOOD} />

          {selectedIndex >= 0 && (
            <line
              x1={x(selectedIndex)}
              x2={x(selectedIndex)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="var(--color-lavender)"
              strokeWidth={1}
            />
          )}
        </svg>
      )}
    </div>
  );
}

type SeriesProps = {
  values: (number | null)[];
  x: (i: number) => number;
  y: (v: number) => number;
  color: string;
};

function Dots({ values, x, y, color }: SeriesProps) {
  return (
    <g fill={color} opacity={0.35}>
      {values.map((v, i) => (v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={1.75} />))}
    </g>
  );
}

/** A path that lifts the pen over missing values instead of bridging them. */
function Line({ values, x, y, color, dashed = false }: SeriesProps & { dashed?: boolean }) {
  let d = "";
  let drawing = false;
  values.forEach((v, i) => {
    if (v === null) {
      drawing = false;
      return;
    }
    d += `${drawing ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    drawing = true;
  });
  return (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinejoin="round"
      strokeLinecap="round"
      strokeDasharray={dashed ? "4 3" : undefined}
    />
  );
}
