import { z } from "zod";

import {
  currencySchema,
  eventFormatSchema,
  evidenceConfidenceSchema,
  feeAmountSchema,
  isoDateSchema,
  memberIdSchema,
  operationalStatusSchema,
  supportStatusSchema,
  timestampSchema,
} from "./enums.js";

const optionalText = z.string().nullable().optional();

export const eventWriteSchema = z.object({
  event_name: z.string().min(1),
  organizer_name: optionalText,
  host_entity: optionalText,
  official_website: optionalText,
  registration_link: optionalText,
  rules_faq_link: optionalText,
  official_domain: optionalText,
  registration_platform: optionalText,
  city: optionalText,
  state_region: optionalText,
  country: optionalText,
  venue: optionalText,
  format: eventFormatSchema.optional(),
  event_start_date: isoDateSchema.nullable().optional(),
  event_end_date: isoDateSchema.nullable().optional(),
  event_timezone: optionalText,
  registration_deadline_at: timestampSchema.nullable().optional(),
  registration_status: optionalText,
  acceptance_date: isoDateSchema.nullable().optional(),
  waitlist_information: optionalText,
  last_verified_at: timestampSchema.optional(),
  student_eligibility: optionalText,
  outside_school_eligibility: optionalText,
  international_student_wording: optionalText,
  age_rules: optionalText,
  geographic_restrictions: optionalText,
  invitation_requirements: optionalText,
  team_size_min: z.number().int().min(0).max(32767).nullable().optional(),
  team_size_max: z.number().int().min(0).max(32767).nullable().optional(),
  solo_participation_policy: optionalText,
  team_formation_rules: optionalText,
  all_members_must_register: z.boolean().nullable().optional(),
  registration_fee_amount: feeAmountSchema.nullable().optional(),
  registration_fee_currency: currencySchema.nullable().optional(),
  registration_fee_notes: optionalText,
  travel_support: supportStatusSchema.optional(),
  lodging_support: supportStatusSchema.optional(),
  meals_support: supportStatusSchema.optional(),
  local_transport_support: supportStatusSchema.optional(),
  travel_support_notes: optionalText,
  reimbursement_conditions: optionalText,
  expenses_paid_upfront: z.boolean().nullable().optional(),
  judging_criteria: optionalText,
  submission_format: optionalText,
  project_start_rules: optionalText,
  pre_existing_code_policy: optionalText,
  ai_tool_policy: optionalText,
  open_source_rules: optionalText,
  data_restrictions: optionalText,
  demo_video_requirements: optionalText,
  intellectual_property_terms: optionalText,
  application_requirements: optionalText,
  organizer_contact_summary: optionalText,
  unresolved_questions: optionalText,
  legitimacy_notes: optionalText,
  risk_flags: optionalText,
  operational_status: operationalStatusSchema,
  evidence_confidence: evidenceConfidenceSchema,
  next_action: optionalText,
  primary_researcher_id: memberIdSchema.nullable().optional(),
  verifier_id: memberIdSchema.nullable().optional(),
  duplicate_of_event_id: memberIdSchema.nullable().optional(),
});

export const eventCreateSchema = eventWriteSchema;
export const eventUpdateSchema = eventWriteSchema.partial();

export const eventListQuerySchema = z.object({
  operational_status: operationalStatusSchema.optional(),
  evidence_confidence: evidenceConfidenceSchema.optional(),
  format: eventFormatSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const deadlineQuerySchema = z.object({
  withinDays: z.coerce.number().int().min(1).max(365).default(30),
});

export type EventCreateInput = z.infer<typeof eventCreateSchema>;
export type EventUpdateInput = z.infer<typeof eventUpdateSchema>;
