import { z } from 'zod';

/**
 * Trigger configuration schema for post-specific automation.
 * E.g. { word: "stack", dm_message: "Here is the DSPy repo: [link]", comment_reply: "Sent to your DMs ⚡" }
 */
export const TriggerConfigSchema = z.object({
  word: z
    .string()
    .min(1, 'Trigger word cannot be empty')
    .transform((w) => w.trim().toLowerCase()),
  dm_message: z
    .string()
    .min(1, 'DM message cannot be empty'),
  comment_reply: z
    .string()
    .min(1, 'Comment reply cannot be empty'),
});

export type TriggerConfig = z.infer<typeof TriggerConfigSchema>;

/**
 * Persisted mapping in Vercel KV: `trigger_map:${media_id}`
 */
export interface TriggerMapRecord {
  media_id: string;
  trigger_config: TriggerConfig;
  created_at: number;
  updated_at?: number;
}
