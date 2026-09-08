import { useState } from "react";
import { useSearchParams } from "react-router";
import { RecordCard } from "../components/RecordCard.js";
import { Button, Chip, EmptyState, ErrorNote, Spinner } from "../components/ui.js";
import { useRecordFeed, useSettings, useTags } from "../lib/queries.js";

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState(params.get("q") ?? "");
  const { data: settings } = useSettings();
  const { data: tags } = useTags();

  const filters = {
    q: params.get("q") ?? undefined,
    tag: params.get("tag") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    limit: 50,
  };
  const feed = useRecordFeed(filters);
  const records = feed.data?.pages.flatMap((page) => page.records) ?? [];

  const setParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const active = Boolean(filters.q || filters.tag || filters.from || filters.to);

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setParam("q", draft.trim() || undefined);
        }}
        className="flex gap-2"
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Search entries…"
          autoFocus
          className="flex-1 rounded-lg border border-surface1 bg-mantle px-3 py-2 text-sm text-text outline-none focus:border-mauve"
        />
        <Button type="submit" variant="primary">
          Search
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={filters.from ?? ""}
          onChange={(event) => setParam("from", event.target.value || undefined)}
          className="rounded-lg border border-surface1 bg-mantle px-2 py-1 text-xs text-subtext1 outline-none focus:border-mauve"
        />
        <span className="text-xs text-overlay0">to</span>
        <input
          type="date"
          value={filters.to ?? ""}
          onChange={(event) => setParam("to", event.target.value || undefined)}
          className="rounded-lg border border-surface1 bg-mantle px-2 py-1 text-xs text-subtext1 outline-none focus:border-mauve"
        />
        {active && (
          <Button
            onClick={() => {
              setDraft("");
              setParams(new URLSearchParams(), { replace: true });
            }}
          >
            Clear
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        {(tags ?? []).slice(0, 20).map((tag) => (
          <Chip
            key={tag.name}
            active={filters.tag === tag.name}
            onClick={() => setParam("tag", filters.tag === tag.name ? undefined : tag.name)}
          >
            #{tag.name} {tag.recordCount + tag.dayCount}
          </Chip>
        ))}
      </div>

      <ErrorNote error={feed.error} />
      {feed.isPending ? (
        <Spinner />
      ) : records.length === 0 ? (
        <EmptyState title={active ? "Nothing matched." : "Search your entries."} />
      ) : (
        <div className="flex flex-col gap-3">
          {records.map((record) => (
            <RecordCard
              key={record.id}
              record={record}
              timeZone={settings?.timeZone ?? "UTC"}
              onTagClick={(tag) => setParam("tag", tag)}
              aiEnabled={settings?.aiEnabled}
            />
          ))}
        </div>
      )}

      {feed.hasNextPage && (
        <Button onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
          {feed.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}
