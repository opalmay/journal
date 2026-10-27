import { Link } from "react-router";
import { dateKeyFromTimestamp } from "@journal/shared";
import { Card } from "./ui.js";
import { useDay, useSettings } from "../lib/queries.js";
import { FIELD_LABELS, dayChips, missingFields } from "../lib/metrics.js";

/**
 * Today's values at a glance, at the top of the timeline. Read-only: setting
 * or fixing a value happens on the day page.
 */
export function TodayCard() {
  const { data: settings } = useSettings();
  const today = dateKeyFromTimestamp(Date.now(), settings?.timeZone ?? "UTC");
  const { data: day } = useDay(today);
  if (!settings || !day) return null;

  const chips = dayChips(day, settings.trackCycle);
  const missing = missingFields(day, settings.trackCycle);

  return (
    <Card className="p-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-mauve">Today</h2>
        <Link to={`/day/${today}`} className="ml-auto text-xs text-overlay1 hover:text-mauve">
          edit →
        </Link>
      </div>
      {chips.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {chips.map(({ field, label }) => (
            <span
              key={field}
              title={day.aiFields.includes(field) ? "Picked up from your entries" : "Set by you"}
              className={`rounded-full px-2 py-0.5 text-xs ${
                day.aiFields.includes(field)
                  ? "bg-mauve/15 text-mauve"
                  : "bg-surface1/60 text-subtext1"
              }`}
            >
              {label}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-xs text-overlay0">
          Nothing yet. Say something like “mood 4, slept badly” in an entry.
        </p>
      )}
      {missing.length > 0 && (
        <p className="mt-2 text-xs text-overlay0">
          Not mentioned: {missing.map((f) => FIELD_LABELS[f]).join(", ")}
        </p>
      )}
    </Card>
  );
}
