import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DAY_MODEL, DEFAULT_TITLE_MODEL } from "./ai/models.js";

// `src/config.ts` and `dist/config.js` sit at the same depth, so both resolve
// to the repository root — a relative DATA_DIR then means the same directory
// no matter which workspace the process was started from.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? def : v === "true" || v === "1"));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATA_DIR: z.string().default("./data"),
  JOURNAL_TZ: z.string().default("Europe/Berlin"),
  SESSION_SECRET: z.string().min(16).default("dev-only-insecure-session-secret!!"),
  AUTH_PASSWORD_HASH: z.string().default(""),
  WEBHOOK_TOKEN: z.string().default(""),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_ENABLED: bool(true),
  // Record titles run once per entry and dominate the call volume; day
  // summaries run once per day over everything in it. Different jobs, so the
  // defaults are different models — see src/ai/client.ts.
  AI_TITLE_MODEL: z.string().default(DEFAULT_TITLE_MODEL),
  AI_DAY_MODEL: z.string().default(DEFAULT_DAY_MODEL),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(64 * 1024 * 1024),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(90),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join("\n")}`);
  }
  const e = parsed.data;

  // Fail loudly in production rather than booting with a guessable secret.
  if (e.NODE_ENV === "production") {
    const missing: string[] = [];
    if (!e.AUTH_PASSWORD_HASH) missing.push("AUTH_PASSWORD_HASH");
    if (!e.WEBHOOK_TOKEN) missing.push("WEBHOOK_TOKEN");
    if (e.SESSION_SECRET === EnvSchema.shape.SESSION_SECRET._def.defaultValue())
      missing.push("SESSION_SECRET");
    if (missing.length)
      throw new Error(`Refusing to start in production without: ${missing.join(", ")}`);
  }

  // Validate the timezone once, here, instead of at every formatting call.
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: e.JOURNAL_TZ });
  } catch {
    throw new Error(`JOURNAL_TZ is not a valid IANA timezone: ${e.JOURNAL_TZ}`);
  }

  const dataDir = path.resolve(REPO_ROOT, e.DATA_DIR);
  return {
    ...e,
    dataDir,
    mediaDir: path.join(dataDir, "media"),
    dbPath: path.join(dataDir, "journal.db"),
    aiEnabled: e.AI_ENABLED && Boolean(e.ANTHROPIC_API_KEY),
  };
}
