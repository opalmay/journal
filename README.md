# journal

A private journal: a day-per-day record of text, tags, media and mood, with AI-written
titles and summaries — and a webhook so a wearable can file entries on its own.

- **Records** are timestamped entries holding text, tags and media. The timestamp
  defaults to now, and decides which day the record belongs to (in `JOURNAL_TZ`,
  not UTC).
- **Days** collect their records and carry their own tags, a 1–5 mood, and a note.
- **Titles** for both are written by Claude in a background job; the app works
  fully without an API key, titles simply stay empty.
- **The ring webhook** accepts the device's `multipart/form-data` POST and turns
  each delivery into a record, keeping the audio and flagging the source.

Theme: Catppuccin Macchiato.

## Layout

```
packages/shared   zod schemas, DTO types, and the timestamp → day-key rule
apps/api          Fastify + node:sqlite backend, media storage, AI worker
apps/web          React + Vite + Tailwind front end
data/             SQLite database and media files (gitignored)
```

## Running it

```bash
npm install
cp .env.example .env

# set a password, then paste the hash into AUTH_PASSWORD_HASH
npm run hash-password -- 'your password'

# fill in SESSION_SECRET and WEBHOOK_TOKEN too:
openssl rand -hex 32

npm run dev          # api on :3000, web on :5173 (proxying /api)
```

For production, `npm run build` then `npm start` — the API serves the built web
app and falls back to `index.html` so client-side routes survive a reload.

Set `ANTHROPIC_API_KEY` to turn on AI titles and summaries. Without it,
`/api/settings` reports `aiEnabled: false` and no jobs run.

## The ring webhook

`POST /api/webhooks/ring`, `multipart/form-data`, authenticated with the shared
secret in an `X-Webhook-Token` header or a `?token=` query parameter:

| field | notes |
|---|---|
| `audio` | `audio/mp4`, optional — only sent when the device is set to *audio* or *both* |
| `transcription` | the text of the recording |
| `recordedAt` | epoch milliseconds; becomes the record's timestamp |
| `client` | `"ring"`; stored on the record alongside `source: "ring"` |

```bash
curl -X POST https://your-host/api/webhooks/ring \
  -H "X-Webhook-Token: $WEBHOOK_TOKEN" \
  -F "audio=@recording.m4a;type=audio/mp4" \
  -F "transcription=walked by the river, felt good" \
  -F "recordedAt=$(date +%s000)" \
  -F "client=ring"
```

Deliveries are deduplicated on `sha256(recordedAt + transcription)`, so a device
that retries gets `200 {"deduped": true}` rather than a second record.

## Deploying to Fly.io

One Machine, one volume, one region — SQLite and the media directory need a
single writer, so the app does not scale horizontally.

```bash
# once
curl -L https://fly.io/install.sh | sh
fly auth login

# edit fly.toml first: `app` must be globally unique, `primary_region`
# should be near you, and JOURNAL_TZ should be your timezone
fly launch --no-deploy --copy-config

# the journal's data lives here and nowhere else
fly volumes create journal_data --size 3 --region fra

fly secrets set \
  SESSION_SECRET="$(openssl rand -hex 32)" \
  WEBHOOK_TOKEN="$(openssl rand -hex 32)" \
  AUTH_PASSWORD_HASH="$(npm run --silent hash-password -- 'your password')" \
  ANTHROPIC_API_KEY="sk-ant-..."

fly deploy
```

`fly secrets set` triggers a redeploy on its own, so the first `fly deploy` may
report there is nothing to do. Read the webhook URL off the Settings page once
you can log in, and point the ring at it.

**The volume is the whole journal.** Every deploy replaces the container
filesystem; anything outside `/data` is gone. Verify it survives a deploy
before you trust it with real entries.

Useful afterwards:

```bash
fly logs                          # includes the AI worker's failures
fly ssh console -C "ls /data/media"
fly volumes snapshots list journal_data
fly scale memory 1024             # if 512MB turns out to be tight
```

**Scale-to-zero** halves the bill but costs you two things: a cold start on the
first ring delivery after an idle period, and day summaries that slip past
their five-minute debounce until something else wakes the Machine (they are
queued in SQLite, so they run late rather than being lost). To enable it, set
`auto_stop_machines = "stop"` and `min_machines_running = 0`.

**Backups.** Fly snapshots volumes daily with short default retention. For
anything you would mind losing, pull a copy down yourself:

```bash
fly ssh console -C "sqlite3 /data/journal.db '.backup /data/backup.db'"
fly sftp get /data/backup.db
```

## Tests

```bash
npm test
```

Covers day-key derivation across DST and local midnight, the webhook contract
(audio, no audio, replay, bad token), record and day CRUD, byte-range media
serving, and the AI job queue's debouncing, retries and backoff.
