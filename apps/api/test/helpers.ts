import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { hashPassword, SESSION_COOKIE } from "../src/auth.js";
import type { Summarizer } from "../src/ai/client.js";

export const TEST_PASSWORD = "correct horse battery staple";
export const TEST_WEBHOOK_TOKEN = "test-webhook-token";

export interface TestContext {
  app: FastifyInstance;
  config: Config;
  dataDir: string;
  cookie: string;
  summarizer: FakeSummarizer;
  close(): Promise<void>;
}

export class FakeSummarizer implements Summarizer {
  recordCalls: string[] = [];
  dayCalls: unknown[] = [];

  async recordTitle(text: string) {
    this.recordCalls.push(text);
    return { title: `title for ${text.slice(0, 20)}` };
  }

  async daySummary(input: unknown) {
    this.dayCalls.push(input);
    return { title: "a day", summary: "things happened", tags: ["generated"] };
  }
}

export async function makeContext(
  overrides: Partial<NodeJS.ProcessEnv> = {},
): Promise<TestContext> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "journal-test-"));
  const config = loadConfig({
    NODE_ENV: "test",
    DATA_DIR: dataDir,
    JOURNAL_TZ: "Europe/Berlin",
    SESSION_SECRET: "test-session-secret-that-is-long-enough",
    AUTH_PASSWORD_HASH: await hashPassword(TEST_PASSWORD),
    WEBHOOK_TOKEN: TEST_WEBHOOK_TOKEN,
    AI_ENABLED: "false",
    ...overrides,
  } as NodeJS.ProcessEnv);

  const summarizer = new FakeSummarizer();
  const app = await buildApp(config, { summarizer, logger: false });
  await app.ready();

  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { password: TEST_PASSWORD },
  });
  const setCookie = login.headers["set-cookie"];
  const raw = Array.isArray(setCookie) ? setCookie[0]! : String(setCookie);
  const cookie = raw.split(";")[0]!;
  if (!cookie.startsWith(SESSION_COOKIE)) throw new Error(`login failed: ${login.body}`);

  return {
    app,
    config,
    dataDir,
    cookie,
    summarizer,
    async close() {
      await app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export interface MultipartField {
  name: string;
  value: string;
}

export interface MultipartFile {
  name: string;
  filename: string;
  contentType: string;
  content: Buffer;
}

/** Builds a multipart/form-data body the way the ring device would send one. */
export function multipart(
  fields: MultipartField[],
  files: MultipartFile[] = [],
  boundary = "----journaltestboundary",
): { payload: Buffer; headers: Record<string, string> } {
  const chunks: Buffer[] = [];
  for (const field of fields) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"\r\n\r\n${field.value}\r\n`,
      ),
    );
  }
  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType}\r\n\r\n`,
      ),
      file.content,
      Buffer.from("\r\n"),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(chunks),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}
