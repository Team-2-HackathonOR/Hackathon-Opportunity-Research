import { z } from "zod";

import {
  applicationMaterialTypeSchema,
  benefitTypeSchema,
  contributionTypeSchema,
  isoDateSchema,
  memberIdSchema,
  milestoneTypeSchema,
  queueTypeSchema,
  readinessStatusSchema,
  sourceKindSchema,
  timestampSchema,
  trackKindSchema,
  verificationResultSchema,
} from "./enums.js";

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const sourceCreateSchema = z.object({
  source_type: sourceKindSchema,
  source_url: z.string().min(1),
  source_title: z.string().nullable().optional(),
  is_primary_source: z.boolean().optional(),
  captured_on: isoDateSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const trackCreateSchema = z.object({
  track_type: trackKindSchema,
  track_name: z.string().min(1),
  description: z.string().nullable().optional(),
});

export const benefitCreateSchema = z.object({
  benefit_type: benefitTypeSchema,
  title: z.string().nullable().optional(),
  description: z.string().min(1),
  is_guaranteed_to_all: z.boolean().optional(),
  award_value: z.string().nullable().optional(),
});

export const milestoneCreateSchema = z.object({
  milestone_type: milestoneTypeSchema,
  milestone_name: z.string().min(1),
  due_at: timestampSchema.nullable().optional(),
  timezone_name: z.string().nullable().optional(),
  is_confirmed: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

export const categoryCreateSchema = z.object({
  category_name: z.string().min(1),
});

export const categoryAssignmentSchema = z.object({
  category_id: memberIdSchema,
  is_primary: z.boolean().optional(),
});

export const shortlistWriteSchema = z.object({
  queue_type: queueTypeSchema,
  why_practical: z.string().trim().min(1),
  shortlisted_by_member_id: memberIdSchema.nullable().optional(),
  confirmed_eligibility: z.boolean().nullable().optional(),
  expected_cost_summary: z.string().nullable().optional(),
  schedule_feasibility: z.string().nullable().optional(),
  technical_relevance: z.string().nullable().optional(),
  organizer_credibility: z.string().nullable().optional(),
  learning_networking_potential: z.string().nullable().optional(),
  evidence_quality_notes: z.string().nullable().optional(),
  still_needs_verification: z.string().nullable().optional(),
});

export const requirementCreateSchema = z.object({
  queue_type: queueTypeSchema,
  requirement_type: applicationMaterialTypeSchema,
  requirement_text: z.string().min(1),
  due_at: timestampSchema.nullable().optional(),
  status: readinessStatusSchema.optional(),
  owner_member_id: memberIdSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const requirementUpdateSchema = requirementCreateSchema.partial();

export const verificationCreateSchema = z.object({
  checked_by_member_id: memberIdSchema,
  verification_scope: z.string().min(1),
  result: verificationResultSchema,
  notes: z.string().nullable().optional(),
});

export const teamMemberCreateSchema = z.object({
  full_name: z.string().min(1),
  email: z.string().email().nullable().optional(),
  role_name: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

export const contributionCreateSchema = z.object({
  member_id: memberIdSchema,
  event_id: memberIdSchema.nullable().optional(),
  contribution_type: contributionTypeSchema,
  notes: z.string().min(1),
  hours_spent: z.number().nonnegative().max(999.99).nullable().optional(),
});
