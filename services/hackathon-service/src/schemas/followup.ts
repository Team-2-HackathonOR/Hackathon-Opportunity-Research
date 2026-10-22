import { z } from "zod";

import { memberIdSchema, responseStatusSchema, timestampSchema } from "./enums.js";

export const followupCreateSchema = z.object({
  event_id: memberIdSchema,
  question_text: z.string().min(1),
  contact_channel: z.string().nullable().optional(),
  contact_target: z.string().nullable().optional(),
  sent_at: timestampSchema.nullable().optional(),
  assigned_member_id: memberIdSchema.nullable().optional(),
  response_status: responseStatusSchema.default("draft"),
  confirmed_answer: z.string().nullable().optional(),
  answered_at: timestampSchema.nullable().optional(),
  evidence_source_id: memberIdSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const followupUpdateSchema = followupCreateSchema.partial();

export type FollowupCreateInput = z.infer<typeof followupCreateSchema>;
export type FollowupUpdateInput = z.infer<typeof followupUpdateSchema>;
