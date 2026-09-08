import { MOODS, moodLabel } from "../lib/mood.js";

export function MoodPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (mood: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {MOODS.map((mood) => {
        const selected = value === mood.value;
        return (
          <button
            key={mood.value}
            type="button"
            title={mood.label}
            aria-pressed={selected}
            // Clicking the selected mood clears it, so a mis-tap is undoable.
            onClick={() => onChange(selected ? null : mood.value)}
            className={`size-8 rounded-lg text-xs font-semibold transition-all ${
              selected ? "scale-110 text-crust" : "text-overlay1 hover:text-text"
            }`}
            style={{
              background: selected ? mood.color : "var(--color-surface0)",
              boxShadow: selected ? `0 0 0 2px ${mood.color}55` : undefined,
            }}
          >
            {mood.value}
          </button>
        );
      })}
      <span className="ml-1 text-xs text-overlay1">{moodLabel(value)}</span>
    </div>
  );
}

export function MoodDot({ mood }: { mood: number | null }) {
  return (
    <span
      title={moodLabel(mood)}
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{ background: mood ? `var(--color-${["", "red", "maroon", "yellow", "green", "teal"][mood]})` : "var(--color-surface2)" }}
    />
  );
}
