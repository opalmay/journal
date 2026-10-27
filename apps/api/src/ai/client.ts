import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { DayMetrics, Mood, type AiField } from "@journal/shared";

import { DEFAULT_DAY_MODEL, DEFAULT_TITLE_MODEL } from "./models.js";

/** Routes around a safety refusal instead of failing the job outright. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * The request shape follows the model. Haiku 4.5 rejects `output_config.effort`
 * and adaptive thinking; Haiku 5.5 takes both but has no server-side refusal
 * fallback, which only the Opus, Sonnet and Fable tiers offer.
 */
function supportsEffort(model: string): boolean {
  return !/^claude-haiku-[34]/.test(model);
}

function supportsFallback(model: string): boolean {
  return !model.startsWith("claude-haiku-");
}

export interface RecordTitleResult {
  title: string;
}

/** What the day's entries say about each asked-for field; null when they don't. */
export type ExtractedMetrics = Partial<Record<AiField, number | string | null>>;

export interface DaySummaryResult {
  title: string;
  summary: string;
  tags: string[];
  metrics: ExtractedMetrics;
  /** For each field, the entry numbers (1-based, as in `lines`) it came from. */
  sources: Partial<Record<AiField, number[]>>;
}

export interface Summarizer {
  recordTitle(text: string): Promise<RecordTitleResult>;
  daySummary(input: DaySummaryInput): Promise<DaySummaryResult>;
}

export interface DaySummaryInput {
  date: string;
  mood: number | null;
  /** One line per record, already in time order: `#n HH:mm — text`. */
  lines: string[];
  existingTags: string[];
  /** Fields to extract. The user's own values are left out and given as context. */
  extract: AiField[];
  userMetrics: Partial<Record<AiField, number | string>>;
}

const RecordTitleSchema = z.object({ title: z.string().min(1).max(120) });
/**
 * An out-of-range metric is dropped rather than failing the whole summary:
 * a missing value is flagged to the author, a lost summary is not.
 */
const ExtractedMetricsSchema = z.object(
  Object.fromEntries(
    Object.entries(DayMetrics.extend({ mood: Mood.nullable() }).shape).map(([field, schema]) => [
      field,
      (schema as z.ZodTypeAny).optional().catch(null),
    ]),
  ),
);

const DaySummarySchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(4000),
  tags: z.array(z.string()).max(8),
  metrics: ExtractedMetricsSchema.default({}),
  sources: z.record(z.array(z.number().int()).catch([])).catch({}).default({}),
});

const RECORD_TITLE_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "At most 8 words, no trailing period." },
  },
  required: ["title"],
  additionalProperties: false,
} as const;

const nullable = (schema: Record<string, unknown>, description: string) => ({
  anyOf: [schema, { type: "null" }],
  description,
});

/** How each field is asked for. The descriptions carry the scales. */
const METRIC_JSON_SCHEMA: Record<AiField, Record<string, unknown>> = {
  mood: nullable(
    { type: "integer", enum: [1, 2, 3, 4, 5] },
    "Overall mood, 1 rough, 2 low, 3 even, 4 good, 5 great.",
  ),
  energy: nullable(
    { type: "integer", enum: [1, 2, 3, 4, 5] },
    "Energy, 1 exhausted to 5 very high. 'energy high' is 4, 'wiped out' is 1.",
  ),
  sleepHours: nullable(
    { type: "number" },
    "Total hours slept the night that ended this day, only if durations were given. " +
      "A night broken by waking up is added up across its parts. Naps are not included.",
  ),
  sleepQuality: nullable(
    { type: "string", enum: ["poor", "ok", "good"] },
    "Quality of last night's sleep. 'slept badly' is poor.",
  ),
  sleepWakings: nullable(
    { type: "integer" },
    "Times the author woke up during the night and went back to sleep. 0 only if they " +
      "said they slept through.",
  ),
  napHours: nullable({ type: "number" }, "Total hours napped during the day."),
  appetite: nullable({ type: "string", enum: ["low", "normal", "high"] }, "Appetite."),
  social: nullable(
    { type: "string", enum: ["none", "some", "a_lot"] },
    "Contact with other people: none, some, or a_lot.",
  ),
  cycleDay: nullable(
    { type: "integer" },
    "Menstrual cycle day, 1 being the first day of a period. 'period started today' is 1.",
  ),
  caffeine: nullable({ type: "integer" }, "Number of caffeinated drinks."),
  alcohol: nullable({ type: "integer" }, "Number of alcoholic drinks."),
  exercise: nullable(
    { type: "string" },
    "Exercise done, a few words in the author's terms, e.g. '30 min run'.",
  ),
  intake: nullable(
    { type: "string" },
    "Medication, supplements or other substances taken, comma separated.",
  ),
};

function daySummaryJsonSchema(extract: AiField[]): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      title: { type: "string", description: "At most 8 words naming the day, no trailing period." },
      summary: { type: "string", description: "Two to four sentences about the day." },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Up to 6 lowercase, hyphenated topic tags.",
      },
      metrics: {
        type: "object",
        properties: Object.fromEntries(extract.map((f) => [f, METRIC_JSON_SCHEMA[f]])),
        required: extract,
        additionalProperties: false,
      },
      sources: {
        type: "object",
        description: "For each metric that is not null, the #numbers of the entries it came from.",
        properties: Object.fromEntries(
          extract.map((f) => [f, { type: "array", items: { type: "integer" } }]),
        ),
        required: extract,
        additionalProperties: false,
      },
    },
    required: ["title", "summary", "tags", "metrics", "sources"],
    additionalProperties: false,
  };
}

const METRICS_INSTRUCTIONS = `Also fill in "metrics" from what the entries say. Use null for anything
not stated or clearly implied; never guess or infer from tone alone, since a
missing value is flagged to the author and a wrong one misleads them. Map
spoken words onto the scales given. If the day contradicts itself, the latest
entry wins. Sleep means the night that ended on this day.

Sleep is often reported in pieces. "Slept 11 to 3, then 5 to 8" is 7 hours
with one waking. A later entry that says "got 3 more hours" or "went back to
sleep" adds to the earlier figure rather than replacing it. Naps go in
napHours, never in sleepHours.

In "sources", list for every metric that is not null the #numbers of the
entries it came from, and an empty list for every null one.`;

const SYSTEM = `You are the summarizer inside someone's private journal.

Write in plain, concrete language, in the third person, describing what the entry
or day was actually about. Never editorialize, never praise, never offer advice,
never add sentiment the author did not express. Titles are labels, not headlines:
no colons, no clickbait, no trailing punctuation. Use the author's own words where
they are specific — names, places, activities. If an entry is trivial or empty of
content, say so plainly rather than inventing significance.`;

/** Longer records are summarized in two passes rather than silently truncated. */
const CHUNK_CHARS = 12_000;

export class ClaudeSummarizer implements Summarizer {
  private readonly client: Anthropic;
  private readonly titleModel: string;
  private readonly dayModel: string;

  constructor(
    options: { apiKey?: string; titleModel?: string; dayModel?: string } = {},
  ) {
    this.client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
    this.titleModel = options.titleModel ?? DEFAULT_TITLE_MODEL;
    this.dayModel = options.dayModel ?? DEFAULT_DAY_MODEL;
  }

  private async ask<T>(
    prompt: string,
    schema: Record<string, unknown>,
    parser: z.ZodType<T>,
    options: { model: string; effort: "low" | "medium"; maxTokens: number },
  ): Promise<T> {
    const effort = supportsEffort(options.model);
    const response = await this.client.beta.messages.create({
      model: options.model,
      max_tokens: options.maxTokens,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      output_config: {
        format: { type: "json_schema", schema },
        ...(effort ? { effort: options.effort } : {}),
      },
      ...(effort ? { thinking: { type: "adaptive" as const } } : {}),
      ...(supportsFallback(options.model)
        ? { betas: [FALLBACK_BETA], fallbacks: "default" as const }
        : {}),
    });

    if (response.stop_reason === "refusal") {
      throw new Error(
        `model declined to summarize (${response.stop_details?.category ?? "unknown"})`,
      );
    }

    const text = response.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    if (!text) throw new Error("model returned no text");

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`model returned non-JSON output: ${text.slice(0, 200)}`);
    }
    return parser.parse(json);
  }

  async recordTitle(text: string): Promise<RecordTitleResult> {
    const body = text.length > CHUNK_CHARS ? await this.condense(text) : text;
    return this.ask(
      `Title this journal entry.\n\n---\n${body}\n---`,
      RECORD_TITLE_JSON_SCHEMA as unknown as Record<string, unknown>,
      RecordTitleSchema,
      { model: this.titleModel, effort: "low", maxTokens: 8_000 },
    );
  }

  /** Folds an over-long entry down chunk by chunk so nothing is dropped unseen. */
  private async condense(text: string): Promise<string> {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += CHUNK_CHARS) chunks.push(text.slice(i, i + CHUNK_CHARS));

    const parts: string[] = [];
    for (const chunk of chunks) {
      const result = await this.ask(
        `Summarize this part of a long journal entry in two sentences.\n\n---\n${chunk}\n---`,
        {
          type: "object",
          properties: { title: { type: "string" } },
          required: ["title"],
          additionalProperties: false,
        },
        RecordTitleSchema,
        { model: this.titleModel, effort: "low", maxTokens: 8_000 },
      );
      parts.push(result.title);
    }
    return parts.join("\n");
  }

  async daySummary(input: DaySummaryInput): Promise<DaySummaryResult> {
    const mood =
      input.mood === null ? "not recorded" : `${input.mood} out of 5 (author's own rating)`;
    const existing = input.existingTags.length
      ? `\nTags the author already put on this day: ${input.existingTags.join(", ")}. Do not repeat them.`
      : "";
    const known = Object.entries(input.userMetrics).filter(([field]) => field !== "mood");
    const prompt = [
      `Summarize this journal day: ${input.date}.`,
      `Mood: ${mood}.${existing}`,
      ...(known.length
        ? [`Recorded by the author: ${known.map(([f, v]) => `${f} ${v}`).join(", ")}.`]
        : []),
      "",
      METRICS_INSTRUCTIONS,
      "",
      "Entries, in order:",
      ...input.lines,
    ].join("\n");

    const result = await this.ask(prompt, daySummaryJsonSchema(input.extract), DaySummarySchema, {
      model: this.dayModel,
      effort: "medium",
      maxTokens: 16_000,
    });
    return {
      ...result,
      metrics: result.metrics as ExtractedMetrics,
      sources: result.sources as Partial<Record<AiField, number[]>>,
    };
  }
}
