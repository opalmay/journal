import { useEffect, useState } from "react";

/**
 * A composer draft kept in localStorage so an unpublished entry survives a
 * refresh, a crash or a dropped connection. Attached files are not stored —
 * File objects can't be serialized — so only text, tags and a custom time.
 */
export type Draft = {
  text: string;
  tags: string[];
  customTime: string | null;
};

const EMPTY: Draft = { text: "", tags: [], customTime: null };

const keyFor = (scope: string) => `journal.draft.v1:${scope}`;

export function isEmptyDraft(draft: Draft): boolean {
  return !draft.text.trim() && draft.tags.length === 0 && draft.customTime === null;
}

function read(scope: string): Draft {
  try {
    const raw = localStorage.getItem(keyFor(scope));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    return {
      text: typeof parsed.text === "string" ? parsed.text : "",
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t) => typeof t === "string") : [],
      customTime: typeof parsed.customTime === "string" ? parsed.customTime : null,
    };
  } catch {
    return EMPTY;
  }
}

function write(scope: string, draft: Draft): void {
  try {
    if (isEmptyDraft(draft)) localStorage.removeItem(keyFor(scope));
    else localStorage.setItem(keyFor(scope), JSON.stringify(draft));
  } catch {
    // Private mode or a full quota: the draft just isn't persisted.
  }
}

/**
 * Restores the draft for `scope` on mount and saves every change back to it.
 * `scope` separates the timeline composer from each day page's composer.
 */
export function useDraft(scope: string): {
  draft: Draft;
  setDraft: (next: Draft | ((current: Draft) => Draft)) => void;
  clearDraft: () => void;
} {
  const [draft, setDraft] = useState<Draft>(() => read(scope));

  // A different scope (navigating between days) is a different draft.
  const [loadedScope, setLoadedScope] = useState(scope);
  if (loadedScope !== scope) {
    setLoadedScope(scope);
    setDraft(read(scope));
  }

  useEffect(() => {
    if (loadedScope !== scope) return;
    write(scope, draft);
  }, [scope, loadedScope, draft]);

  return {
    draft,
    setDraft,
    clearDraft: () => {
      setDraft(EMPTY);
      write(scope, EMPTY);
    },
  };
}
