import { useEffect, useState, type ReactNode } from "react";
import type { AiField, DayDTO, DayMetrics } from "@journal/shared";
import { FIELD_LABELS, missingFields } from "../lib/metrics.js";

/** Marks a value the day summary picked up from the entries. */
export function AiMark() {
  return (
    <span
      title="Picked up from your entries. Set it yourself and it stays yours."
      className="rounded bg-mauve/15 px-1 font-mono text-[10px] text-mauve"
    >
      ai
    </span>
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T | null;
  options: readonly { value: T; label: string }[];
  onChange: (value: T | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            // Clicking the selected option clears it, as in the mood picker.
            onClick={() => onChange(selected ? null : option.value)}
            className={`min-w-8 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${
              selected ? "bg-mauve text-crust" : "bg-surface0 text-overlay1 hover:text-text"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A text or number field that commits on blur or Enter, and adopts the
 * server's value whenever it changes underneath.
 */
function CommitInput({
  value,
  onCommit,
  type = "text",
  placeholder,
  className = "",
  step,
}: {
  value: string | number | null;
  onCommit: (value: string) => void;
  type?: "text" | "number";
  placeholder?: string;
  className?: string;
  step?: number;
}) {
  const server = value === null ? "" : String(value);
  const [draft, setDraft] = useState(server);
  useEffect(() => setDraft(server), [server]);

  const commit = () => {
    if (draft.trim() !== server) onCommit(draft.trim());
  };
  return (
    <input
      type={type}
      inputMode={type === "number" ? "decimal" : undefined}
      min={type === "number" ? 0 : undefined}
      step={step}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={`rounded-lg border border-surface1 bg-mantle px-2 py-1 text-sm text-text outline-none focus:border-mauve ${className}`}
    />
  );
}

function Row({ label, ai, children }: { label: string; ai: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="flex w-24 items-center gap-1 text-xs text-subtext0">
        {label}
        {ai && <AiMark />}
      </span>
      <div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

const ENERGY = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }));
const SLEEP_QUALITY = [
  { value: "poor", label: "poor" },
  { value: "ok", label: "ok" },
  { value: "good", label: "good" },
] as const;
const APPETITE = [
  { value: "low", label: "low" },
  { value: "normal", label: "normal" },
  { value: "high", label: "high" },
] as const;
const SOCIAL = [
  { value: "none", label: "none" },
  { value: "some", label: "some" },
  { value: "a_lot", label: "a lot" },
] as const;

const toNumber = (raw: string): number | null => {
  const n = Number(raw);
  return raw === "" || Number.isNaN(n) ? null : n;
};

/**
 * Everything about a day besides mood. Mostly filled in by the day summary
 * from what was said; anything set here wins over it for good.
 */
export function MetricsPanel({
  day,
  trackCycle,
  onChange,
}: {
  day: DayDTO;
  trackCycle: boolean;
  onChange: (metrics: Partial<DayMetrics>) => void;
}) {
  const m = day.metrics;
  const ai = (field: AiField) => day.aiFields.includes(field);
  const set = <K extends keyof DayMetrics>(field: K, value: DayMetrics[K]) =>
    onChange({ [field]: value } as Partial<DayMetrics>);
  const missing = missingFields(day, trackCycle);

  return (
    <div className="flex flex-col gap-2">
      <Row label="energy" ai={ai("energy")}>
        <Segmented value={m.energy} options={ENERGY} onChange={(v) => set("energy", v)} />
      </Row>
      <Row label="sleep" ai={ai("sleepHours") || ai("sleepQuality") || ai("sleepWakings")}>
        <CommitInput
          type="number"
          step={0.5}
          value={m.sleepHours}
          placeholder="h"
          className="w-16"
          onCommit={(v) => set("sleepHours", toNumber(v))}
        />
        <Segmented
          value={m.sleepQuality}
          options={SLEEP_QUALITY}
          onChange={(v) => set("sleepQuality", v)}
        />
        <label className="flex items-center gap-1 text-xs text-overlay1">
          woke
          <CommitInput
            type="number"
            value={m.sleepWakings}
            className="w-12"
            onCommit={(v) => set("sleepWakings", toNumber(v))}
          />
        </label>
      </Row>
      <Row label="nap" ai={ai("napHours") || ai("napTimes")}>
        <CommitInput
          type="number"
          step={0.5}
          value={m.napHours}
          placeholder="h"
          className="w-16"
          onCommit={(v) => set("napHours", toNumber(v))}
        />
        <label className="flex items-center gap-1 text-xs text-overlay1">
          at
          <CommitInput
            value={m.napTimes}
            placeholder="13:00–14:00"
            className="w-28"
            onCommit={(v) => set("napTimes", v || null)}
          />
        </label>
      </Row>
      <Row label="appetite" ai={ai("appetite")}>
        <Segmented value={m.appetite} options={APPETITE} onChange={(v) => set("appetite", v)} />
      </Row>
      <Row label="social" ai={ai("social")}>
        <Segmented value={m.social} options={SOCIAL} onChange={(v) => set("social", v)} />
      </Row>
      {trackCycle && (
        <Row label="cycle day" ai={ai("cycleDay")}>
          <CommitInput
            type="number"
            value={day.cycleDayDerived ? null : m.cycleDay}
            placeholder={day.cycleDayDerived ? `≈ ${m.cycleDay}` : "day"}
            className="w-16"
            onCommit={(v) => set("cycleDay", toNumber(v))}
          />
          {day.cycleDayDerived && (
            <span className="text-xs text-overlay0">counted from the last one you gave</span>
          )}
        </Row>
      )}
      <Row label="drinks" ai={ai("caffeine") || ai("alcohol")}>
        <label className="flex items-center gap-1 text-xs text-overlay1">
          caffeine
          <CommitInput
            type="number"
            value={m.caffeine}
            className="w-14"
            onCommit={(v) => set("caffeine", toNumber(v))}
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-overlay1">
          alcohol
          <CommitInput
            type="number"
            value={m.alcohol}
            className="w-14"
            onCommit={(v) => set("alcohol", toNumber(v))}
          />
        </label>
      </Row>
      <Row label="exercise" ai={ai("exercise")}>
        <CommitInput
          value={m.exercise}
          placeholder="e.g. 30 min run"
          className="min-w-0 flex-1"
          onCommit={(v) => set("exercise", v || null)}
        />
      </Row>
      <Row label="took" ai={ai("intake")}>
        <CommitInput
          value={m.intake}
          placeholder="meds, supplements…"
          className="min-w-0 flex-1"
          onCommit={(v) => set("intake", v || null)}
        />
      </Row>
      {missing.length > 0 && (
        <p className="text-xs text-overlay0">
          Not mentioned: {missing.map((f) => FIELD_LABELS[f]).join(", ")}
        </p>
      )}
    </div>
  );
}
