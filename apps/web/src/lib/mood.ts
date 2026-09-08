/** Mood 1-5, mapped once so the picker, day badge and calendar always agree. */
export const MOODS = [
  { value: 1, label: "Rough", color: "var(--color-red)", emoji: "▁" },
  { value: 2, label: "Low", color: "var(--color-maroon)", emoji: "▃" },
  { value: 3, label: "Even", color: "var(--color-yellow)", emoji: "▅" },
  { value: 4, label: "Good", color: "var(--color-green)", emoji: "▆" },
  { value: 5, label: "Great", color: "var(--color-teal)", emoji: "█" },
] as const;

export function moodColor(mood: number | null | undefined): string {
  return MOODS.find((m) => m.value === mood)?.color ?? "var(--color-surface1)";
}

export function moodLabel(mood: number | null | undefined): string {
  return MOODS.find((m) => m.value === mood)?.label ?? "No mood";
}
