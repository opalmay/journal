/**
 * Default models, kept out of `client.ts` so `config.ts` can name them without
 * importing the Anthropic SDK.
 *
 * Record titles are a labelling task over one short entry, run once per entry —
 * the bulk of the calls, and the bulk of the bill if the model reasons first.
 * Day summaries run once per day over everything in it, and that judgement is
 * worth paying for.
 */
export const DEFAULT_TITLE_MODEL = "claude-haiku-4-5";
export const DEFAULT_DAY_MODEL = "claude-opus-5";
