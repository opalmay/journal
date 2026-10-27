export interface Notification {
  title: string;
  message: string;
  /** ntfy tags; ones that name an emoji (e.g. "notebook") render as that emoji. */
  tags?: string[];
  /** URL opened when the notification is tapped. */
  click?: string;
}

export interface Notifier {
  send(topic: string, notification: Notification): Promise<void>;
}

/**
 * Publishes to an ntfy server with a plain HTTP POST — no client library, no
 * subscription state on our side. Whoever subscribes to the topic gets it, so
 * the topic name is the secret and messages never carry journal content.
 */
export class NtfyNotifier implements Notifier {
  constructor(
    private readonly server: string,
    private readonly token: string = "",
  ) {}

  async send(topic: string, n: Notification): Promise<void> {
    const headers: Record<string, string> = { Title: n.title };
    if (n.tags?.length) headers.Tags = n.tags.join(",");
    if (n.click) headers.Click = n.click;
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const response = await fetch(`${this.server}/${topic}`, {
      method: "POST",
      body: n.message,
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 200);
      throw new Error(`ntfy responded ${response.status}: ${body}`);
    }
  }
}

/**
 * Links that subscribe a device to the topic. `ntfy://` opens the ntfy app
 * straight to its subscribe dialog; the https link is the web client, and a
 * fallback wherever the app is not installed.
 */
export function subscribeLinks(server: string, topic: string): { app: string; web: string } {
  const url = new URL(server);
  const base = `${url.host}${url.pathname.replace(/\/+$/, "")}`;
  const insecure = url.protocol === "http:" ? "?secure=false" : "";
  return { app: `ntfy://${base}/${topic}${insecure}`, web: `${server}/${topic}` };
}
