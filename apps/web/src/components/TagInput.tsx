import { useState, type KeyboardEvent } from "react";
import { normalizeTag } from "@journal/shared";
import { Chip } from "./ui.js";

export function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder = "Add a tag…",
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const tag = normalizeTag(raw);
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "," || event.key === " ") {
      if (draft.trim()) {
        event.preventDefault();
        add(draft);
      }
    } else if (event.key === "Backspace" && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const unused = suggestions.filter((tag) => !value.includes(tag)).slice(0, 6);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-surface1 bg-mantle px-2 py-1.5">
        {value.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => onChange(value.filter((t) => t !== tag))}
            className="rounded-full bg-mauve/20 px-2 py-0.5 text-xs font-medium text-mauve hover:bg-red/20 hover:text-red"
            title="Remove tag"
          >
            {tag} ×
          </button>
        ))}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={value.length ? "" : placeholder}
          className="min-w-24 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-overlay0"
        />
      </div>
      {unused.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {unused.map((tag) => (
            <Chip key={tag} onClick={() => add(tag)}>
              + {tag}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
