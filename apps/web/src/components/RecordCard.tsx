import { useState } from "react";
import type { RecordDTO } from "@journal/shared";
import { timeOfDay } from "@journal/shared";
import { Button, Chip, ErrorNote } from "./ui.js";
import { TagInput } from "./TagInput.js";
import { useDeleteRecord, useRegenerate, useUpdateRecord } from "../lib/queries.js";

function RingBadge() {
  return (
    <span
      title="Captured by the ring"
      className="inline-flex items-center gap-1 rounded-full bg-sapphire/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-sapphire uppercase"
    >
      <span className="inline-block size-2 rounded-full border-[1.5px] border-sapphire" />
      ring
    </span>
  );
}

function MediaBlock({ media }: { media: RecordDTO["media"] }) {
  if (media.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-2">
      {media.map((item) => {
        if (item.kind === "audio") {
          return <audio key={item.id} controls preload="none" src={item.url} className="w-full max-w-md" />;
        }
        if (item.kind === "image") {
          return (
            <a key={item.id} href={item.url} target="_blank" rel="noreferrer">
              <img
                src={item.url}
                alt={item.originalName ?? "attachment"}
                loading="lazy"
                className="max-h-96 rounded-lg border border-surface1 object-contain"
              />
            </a>
          );
        }
        if (item.kind === "video") {
          return <video key={item.id} controls preload="none" src={item.url} className="max-h-96 rounded-lg" />;
        }
        return (
          <a
            key={item.id}
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-blue hover:underline"
          >
            {item.originalName ?? "attachment"}
          </a>
        );
      })}
    </div>
  );
}

export function RecordCard({
  record,
  timeZone,
  onTagClick,
  aiEnabled,
}: {
  record: RecordDTO;
  timeZone: string;
  onTagClick?: (tag: string) => void;
  aiEnabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(record.text);
  const [tags, setTags] = useState(record.tags);
  const update = useUpdateRecord();
  const remove = useDeleteRecord();
  const regenerate = useRegenerate();

  const save = () => {
    update.mutate(
      { id: record.id, text, tags },
      { onSuccess: () => setEditing(false) },
    );
  };

  return (
    <article className="group relative rounded-xl border border-surface1 bg-surface0/50 p-4 transition-colors hover:border-surface2">
      <header className="flex flex-wrap items-center gap-2">
        <time
          dateTime={new Date(record.timestamp).toISOString()}
          className="font-mono text-xs text-overlay1 tabular-nums"
        >
          {timeOfDay(record.timestamp, timeZone)}
        </time>
        {record.source === "ring" && <RingBadge />}
        {record.title && <h3 className="text-sm font-semibold text-text">{record.title}</h3>}
        <div className="ml-auto flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {aiEnabled && (
            <Button
              variant="danger"
              onClick={() => regenerate.mutate({ kind: "record", id: record.id })}
              title="Regenerate the title"
            >
              ↻
            </Button>
          )}
          <Button variant="danger" onClick={() => setEditing((v) => !v)}>
            {editing ? "Cancel" : "Edit"}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (confirm("Delete this entry? Its media is deleted too.")) remove.mutate(record.id);
            }}
          >
            Delete
          </Button>
        </div>
      </header>

      {editing ? (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={Math.min(12, Math.max(3, text.split("\n").length + 1))}
            className="w-full resize-y rounded-lg border border-surface1 bg-mantle p-3 text-sm text-text outline-none focus:border-mauve"
          />
          <TagInput value={tags} onChange={setTags} />
          <ErrorNote error={update.error} />
          <div className="flex gap-2">
            <Button variant="primary" onClick={save} disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        record.text.trim() && (
          <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-subtext1">
            {record.text}
          </p>
        )
      )}

      <MediaBlock media={record.media} />

      {record.tags.length > 0 && !editing && (
        <div className="mt-3 flex flex-wrap gap-1">
          {record.tags.map((tag) => (
            <Chip key={tag} onClick={onTagClick ? () => onTagClick(tag) : undefined}>
              #{tag}
            </Chip>
          ))}
        </div>
      )}
      <ErrorNote error={remove.error} />
    </article>
  );
}
