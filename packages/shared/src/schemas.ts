import { z } from "zod";
import { DATE_KEY_RE, normalizeTag } from "./dates.js";

export const Mood = z.number().int().min(1).max(5);
export type Mood = z.infer<typeof Mood>;

// --- day metrics ---------------------------------------------------------

export const SleepQuality = z.enum(["poor", "ok", "good"]);
export type SleepQuality = z.infer<typeof SleepQuality>;
export const Appetite = z.enum(["low", "normal", "high"]);
export type Appetite = z.infer<typeof Appetite>;
export const Social = z.enum(["none", "some", "a_lot"]);
export type Social = z.infer<typeof Social>;

/** Every dimension of a day besides mood. All optional: most days mention few. */
export const DayMetrics = z.object({
  energy: z.number().int().min(1).max(5).nullable(),
  sleepHours: z.number().min(0).max(24).nullable(),
  sleepQuality: SleepQuality.nullable(),
  appetite: Appetite.nullable(),
  social: Social.nullable(),
  cycleDay: z.number().int().min(1).max(60).nullable(),
  caffeine: z.number().int().min(0).max(50).nullable(),
  alcohol: z.number().int().min(0).max(50).nullable(),
  exercise: z.string().trim().max(200).nullable(),
  intake: z.string().trim().max(500).nullable(),
});
export type DayMetrics = z.infer<typeof DayMetrics>;
export type MetricField = keyof DayMetrics;
export const METRIC_FIELDS = Object.keys(DayMetrics.shape) as MetricField[];

/** Fields the day summary job may fill in: every metric, plus mood. */
export type AiField = MetricField | "mood";

export const RecordSource = z.enum(["web", "ring", "api"]);
export type RecordSource = z.infer<typeof RecordSource>;

export const MediaKind = z.enum(["audio", "image", "video", "file"]);
export type MediaKind = z.infer<typeof MediaKind>;

export const DateKeySchema = z.string().regex(DATE_KEY_RE, "expected YYYY-MM-DD");

/** Tags arrive as free text and are normalized before they ever hit the db. */
export const TagList = z
  .array(z.string())
  .max(32)
  .transform((tags) => [...new Set(tags.map(normalizeTag).filter(Boolean))]);

// --- input ---------------------------------------------------------------

export const CreateRecordInput = z.object({
  text: z.string().max(50_000).default(""),
  tags: TagList.default([]),
  timestamp: z.coerce.number().int().positive().optional(),
});
export type CreateRecordInput = z.input<typeof CreateRecordInput>;

export const UpdateRecordInput = z
  .object({
    text: z.string().max(50_000).optional(),
    title: z.string().max(200).nullable().optional(),
    tags: TagList.optional(),
    timestamp: z.coerce.number().int().positive().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "no fields to update");
export type UpdateRecordInput = z.input<typeof UpdateRecordInput>;

export const UpdateDayInput = z
  .object({
    mood: Mood.nullable().optional(),
    note: z.string().max(50_000).nullable().optional(),
    title: z.string().max(200).nullable().optional(),
    summary: z.string().max(10_000).nullable().optional(),
    tags: TagList.optional(),
    metrics: DayMetrics.partial().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "no fields to update");
export type UpdateDayInput = z.input<typeof UpdateDayInput>;

export const RingWebhookFields = z.object({
  transcription: z.string().min(1).max(50_000),
  recordedAt: z.coerce.number().int().positive(),
  client: z.string().min(1).max(64).default("ring"),
});
export type RingWebhookFields = z.infer<typeof RingWebhookFields>;

export const RecordQuery = z.object({
  from: DateKeySchema.optional(),
  to: DateKeySchema.optional(),
  tag: z.string().optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type RecordQuery = z.infer<typeof RecordQuery>;

export const DayRangeQuery = z.object({
  from: DateKeySchema,
  to: DateKeySchema,
});

export const LoginInput = z.object({ password: z.string().min(1).max(500) });

// --- output --------------------------------------------------------------

export interface MediaDTO {
  id: string;
  kind: MediaKind;
  mimeType: string;
  originalName: string | null;
  sizeBytes: number;
  url: string;
}

export interface RecordDTO {
  id: string;
  dayDate: string;
  timestamp: number;
  text: string;
  title: string | null;
  source: RecordSource;
  clientName: string | null;
  tags: string[];
  media: MediaDTO[];
  createdAt: number;
  updatedAt: number;
}

export interface DayDTO {
  date: string;
  title: string | null;
  summary: string | null;
  note: string | null;
  mood: Mood | null;
  metrics: DayMetrics;
  /** Fields whose value came from the AI rather than the user. */
  aiFields: AiField[];
  /** Fields the last extraction looked for and could not find. */
  metricsMissing: AiField[];
  /** True when `metrics.cycleDay` was counted on from an earlier day. */
  cycleDayDerived: boolean;
  tags: string[];
  recordCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface DayDetailDTO extends DayDTO {
  records: RecordDTO[];
}

export interface TagDTO {
  name: string;
  recordCount: number;
  dayCount: number;
}
