import { useRef, useState, type DragEvent } from "react";
import { Button, ErrorNote } from "./ui.js";
import { TagInput } from "./TagInput.js";
import { useCreateRecord, useTags } from "../lib/queries.js";

/** `<input type="datetime-local">` wants local wall-clock, not an ISO instant. */
function toLocalInputValue(ms: number): string {
  const date = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

export function Composer({ defaultDate }: { defaultDate?: string }) {
  const [text, setText] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [customTime, setCustomTime] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const create = useCreateRecord();
  const { data: knownTags } = useTags();

  const addFiles = (incoming: FileList | null) => {
    if (incoming) setFiles((current) => [...current, ...Array.from(incoming)]);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  };

  const openTimeControl = () => {
    // A day page composes for that day; default to noon there, else now.
    const base = defaultDate ? new Date(`${defaultDate}T12:00:00`).getTime() : Date.now();
    setCustomTime(toLocalInputValue(base));
  };

  const submit = () => {
    if (!text.trim() && files.length === 0) return;
    const timestamp = customTime ? new Date(customTime).getTime() : undefined;

    const done = () => {
      setText("");
      setTags([]);
      setFiles([]);
      setCustomTime(null);
    };

    if (files.length > 0) {
      const form = new FormData();
      form.set("text", text);
      form.set("tags", JSON.stringify(tags));
      if (timestamp) form.set("timestamp", String(timestamp));
      for (const file of files) form.append("file", file);
      create.mutate(form, { onSuccess: done });
    } else {
      create.mutate({ text, tags, timestamp }, { onSuccess: done });
    }
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`rounded-xl border bg-surface0/60 p-3 transition-colors ${
        dragging ? "border-mauve bg-mauve/5" : "border-surface1"
      }`}
    >
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit();
        }}
        rows={3}
        placeholder={dragging ? "Drop files to attach…" : "What happened?"}
        className="w-full resize-y bg-transparent p-1 text-sm leading-relaxed text-text outline-none placeholder:text-overlay0"
      />

      {files.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              <button
                type="button"
                onClick={() => setFiles(files.filter((_, i) => i !== index))}
                className="rounded-full bg-surface1 px-2 py-0.5 text-xs text-subtext0 hover:text-red"
              >
                {file.name} ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <TagInput value={tags} onChange={setTags} suggestions={(knownTags ?? []).map((t) => t.name)} />

      {customTime !== null && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="datetime-local"
            value={customTime}
            onChange={(event) => setCustomTime(event.target.value)}
            className="rounded-lg border border-surface1 bg-mantle px-2 py-1 text-xs text-subtext1 outline-none focus:border-mauve"
          />
          <button
            type="button"
            onClick={() => setCustomTime(null)}
            className="text-xs text-overlay1 hover:text-red"
          >
            use now
          </button>
        </div>
      )}

      <ErrorNote error={create.error} />

      <div className="mt-2 flex items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => addFiles(event.target.files)}
        />
        <Button onClick={() => fileInput.current?.click()}>Attach</Button>
        {customTime === null && <Button onClick={openTimeControl}>Change time</Button>}
        <span className="ml-auto text-[11px] text-overlay0">⌘↵</span>
        <Button
          variant="primary"
          onClick={submit}
          disabled={create.isPending || (!text.trim() && files.length === 0)}
        >
          {create.isPending ? "Saving…" : "Add entry"}
        </Button>
      </div>
    </div>
  );
}
