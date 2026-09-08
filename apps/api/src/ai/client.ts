import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { DEFAULT_DAY_MODEL, DEFAULT_TITLE_MODEL } from "./models.js";

/** Routes around a safety refusal instead of failing the job outright. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Haiku 4.5 rejects `output_config.effort` and has no adaptive thinking, and
 * server-side refusal fallbacks are an Opus-tier feature. The request shape
 * therefore follows the model, not the other way round.
 */
function isReasoningModel(model: string): boolean {
  return !model.startsWith("claude-haiku-");
}

export interface RecordTitleResult {
  title: string;
}

export interface DaySummaryResult {
  title: string;
  summary: string;
  tags: string[];
}

export interface Summarizer {
  recordTitle(text: string): Promise<RecordTitleResult>;
  daySummary(input: DaySummaryInput): Promise<DaySummaryResult>;
}

export interface DaySummaryInput {
  date: string;
  mood: number | null;
  /** One line per record, already in time order: `HH:mm — text`. */
  lines: string[];
  existingTags: string[];
}

const RecordTitleSchema = z.object({ title: z.string().min(1).max(120) });
const DaySummarySchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(4000),
  tags: z.array(z.string()).max(8),
});

const RECORD_TITLE_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "At most 8 words, no trailing period." },
  },
  required: ["title"],
  additionalProperties: false,
} as const;

const DAY_SUMMARY_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "At most 8 words naming the day, no trailing period." },
    summary: { type: "string", description: "Two to four sentences about the day." },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Up to 6 lowercase, hyphenated topic tags.",
    },
  },
  required: ["title", "summary", "tags"],
  additionalProperties: false,
} as const;

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
    const reasoning = isReasoningModel(options.model);
    const response = await this.client.beta.messages.create({
      model: options.model,
      max_tokens: options.maxTokens,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      output_config: {
        format: { type: "json_schema", schema },
        ...(reasoning ? { effort: options.effort } : {}),
      },
      ...(reasoning
        ? {
            betas: [FALLBACK_BETA],
            fallbacks: "default" as const,
            thinking: { type: "adaptive" as const },
          }
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
    const prompt = [
      `Summarize this journal day: ${input.date}.`,
      `Mood: ${mood}.${existing}`,
      "",
      "Entries, in order:",
      ...input.lines,
    ].join("\n");

    return this.ask(
      prompt,
      DAY_SUMMARY_JSON_SCHEMA as unknown as Record<string, unknown>,
      DaySummarySchema,
      { model: this.dayModel, effort: "medium", maxTokens: 16_000 },
    );
  }
}
