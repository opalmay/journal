import { z } from "zod";
import { DATE_KEY_RE, normalizeTag } from "./dates.js";

export const Mood = z.number().int().min(1).max(5);
export type Mood = z.infer<typeof Mood>;

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
