import { useState } from "react";
import { Button, Card, ErrorNote, Spinner } from "../components/ui.js";
import { useSettings } from "../lib/queries.js";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-surface1/60 py-2 last:border-0">
      <span className="text-sm text-subtext0">{label}</span>
      <span className="text-right text-sm text-text">{children}</span>
    </div>
  );
}

export function SettingsPage() {
  const { data, isPending, error } = useSettings();
  const [copied, setCopied] = useState(false);

  if (isPending) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  const settings = data!;

  const webhookUrl = `${window.location.origin}${settings.webhookPath}`;
  const curl = [
    `curl -X POST ${webhookUrl} \\`,
    `  -H "X-Webhook-Token: $WEBHOOK_TOKEN" \\`,
    `  -F "audio=@recording.m4a;type=audio/mp4" \\`,
    `  -F "transcription=what you said" \\`,
    `  -F "recordedAt=$(date +%s000)" \\`,
    `  -F "client=ring"`,
  ].join("\n");

  const copy = async () => {
    await navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold text-text">Settings</h1>

      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold text-mauve">Journal</h2>
        <Row label="Timezone">{settings.timeZone}</Row>
        <Row label="AI summaries">
          {settings.aiEnabled ? (
            <span className="text-green">on</span>
          ) : (
            <span className="text-overlay1">off — set ANTHROPIC_API_KEY</span>
          )}
        </Row>
        {settings.aiEnabled && (
          <Row label="Models">
            <span className="font-mono text-xs">
              {settings.aiModels.title} · {settings.aiModels.day}
            </span>
          </Row>
        )}
        <Row label="Max upload">{formatBytes(settings.maxUploadBytes)}</Row>
        <Row label="Stored media">
          {settings.storage.files} files · {formatBytes(settings.storage.bytes)}
        </Row>
        <Row label="AI jobs">
          {Object.entries(settings.jobs).length === 0
            ? "none"
            : Object.entries(settings.jobs)
                .map(([status, count]) => `${count} ${status}`)
                .join(", ")}
        </Row>
      </Card>

      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold text-mauve">Ring webhook</h2>
        <p className="text-sm text-subtext0">
          Point the device at this URL. It must be reachable over HTTPS and carry the shared token
          in an <code className="font-mono text-xs">X-Webhook-Token</code> header, or as a{" "}
          <code className="font-mono text-xs">?token=</code> query parameter if the device only
          lets you set a URL.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg bg-mantle px-3 py-2 font-mono text-xs text-sky">
            {webhookUrl}
          </code>
          <Button onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</Button>
        </div>
        {!settings.webhookTokenSet && (
          <p className="mt-2 text-xs text-yellow">
            WEBHOOK_TOKEN is not set — the webhook returns 503 until it is.
          </p>
        )}
        <pre className="mt-3 overflow-x-auto rounded-lg bg-crust p-3 font-mono text-[11px] leading-relaxed text-subtext0">
          {curl}
        </pre>
      </Card>
    </div>
  );
}
