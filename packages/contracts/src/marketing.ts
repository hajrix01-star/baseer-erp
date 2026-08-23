import { z } from "zod";

import { companyIdSchema } from "./identity.js";
import { idempotencyKeySchema } from "./finance.js";

const marketingIdSchema = z.string().uuid();

/** A campaign is business context, never a financial posting or a provider action. */
export const marketingCampaignPlatformSchema = z.enum(["MANUAL", "GOOGLE_ADS", "META", "TIKTOK", "SNAPCHAT", "OTHER"]);
export const marketingCampaignStatusSchema = z.enum(["DRAFT", "PLANNED", "ACTIVE", "COMPLETED", "CANCELLED", "ARCHIVED"]);
export const marketingReputationReplyAutomationStatusSchema = z.enum(["DISABLED", "ENABLED", "PAUSED"]);
export const marketingReputationReplyAuthoringMethodSchema = z.enum(["TEMPLATE", "BASIRA_DRAFT"]);
export const marketingReputationReplyToneSchema = z.enum(["WARM", "PROFESSIONAL", "FORMAL"]);
export const marketingReputationReplyLanguageModeSchema = z.enum(["MATCH_REVIEW", "ARABIC", "ENGLISH"]);

/** Configuration only. It has no provider credential or authority to publish. */
export const marketingReputationReplyPolicySchema = z.object({
  automationStatus: marketingReputationReplyAutomationStatusSchema,
  authoringMethod: marketingReputationReplyAuthoringMethodSchema,
  tone: marketingReputationReplyToneSchema,
  languageMode: marketingReputationReplyLanguageModeSchema,
  autoFourFiveEnabled: z.boolean(),
  autoThreeIfSafe: z.boolean(),
  signature: z.string().max(160).nullable(),
  revision: z.number().int().positive(),
  executionReadiness: z.literal("NOT_CONNECTED"),
}).strict();

export const marketingCampaignSchema = z.object({
  id: marketingIdSchema,
  titleAr: z.string().min(1).max(160),
  titleEn: z.string().max(160).nullable(),
  platform: marketingCampaignPlatformSchema,
  externalReference: z.string().max(160).nullable(),
  startsOn: z.string().date().nullable(),
  endsOn: z.string().date().nullable(),
  status: marketingCampaignStatusSchema,
  objective: z.string().max(500).nullable(),
  notes: z.string().max(2_000).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export const marketingWorkspaceSchema = z.object({
  companyId: companyIdSchema,
  campaigns: z.array(marketingCampaignSchema).max(1_000),
  readiness: z.array(z.object({
    provider: z.enum(["GOOGLE_ADS", "GOOGLE_BUSINESS"]),
    status: z.literal("NOT_CONNECTED"),
    messageAr: z.string().min(1).max(500),
  }).strict()).length(2),
  replyPolicy: marketingReputationReplyPolicySchema,
}).strict();

const campaignPayloadSchema = z.object({
  titleAr: z.string().trim().min(1).max(160),
  titleEn: z.string().trim().max(160).optional(),
  platform: marketingCampaignPlatformSchema,
  externalReference: z.string().trim().max(160).optional(),
  startsOn: z.string().date().optional(),
  endsOn: z.string().date().optional(),
  status: marketingCampaignStatusSchema.exclude(["ARCHIVED"]),
  objective: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2_000).optional(),
}).strict().refine((value) => !value.startsOn || !value.endsOn || value.startsOn <= value.endsOn, { path: ["endsOn"], message: "Campaign end must not precede its start." });

export const createMarketingCampaignRequestSchema = campaignPayloadSchema.extend({ idempotencyKey: idempotencyKeySchema }).strict();
export const updateMarketingCampaignRequestSchema = campaignPayloadSchema.extend({ idempotencyKey: idempotencyKeySchema }).strict();
export const archiveMarketingCampaignRequestSchema = z.object({
  campaignId: marketingIdSchema,
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
}).strict();
export const marketingEntityReceiptSchema = z.object({ id: marketingIdSchema, replayed: z.boolean() }).strict();
export const updateMarketingReputationReplyPolicyRequestSchema = z.object({
  automationStatus: marketingReputationReplyAutomationStatusSchema,
  authoringMethod: marketingReputationReplyAuthoringMethodSchema,
  tone: marketingReputationReplyToneSchema,
  languageMode: marketingReputationReplyLanguageModeSchema,
  autoFourFiveEnabled: z.boolean(),
  autoThreeIfSafe: z.boolean(),
  signature: z.string().trim().max(160).optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export type MarketingWorkspace = z.infer<typeof marketingWorkspaceSchema>;
export type CreateMarketingCampaignRequest = z.infer<typeof createMarketingCampaignRequestSchema>;
export type UpdateMarketingCampaignRequest = z.infer<typeof updateMarketingCampaignRequestSchema>;
export type ArchiveMarketingCampaignRequest = z.infer<typeof archiveMarketingCampaignRequestSchema>;
export type UpdateMarketingReputationReplyPolicyRequest = z.infer<typeof updateMarketingReputationReplyPolicyRequestSchema>;
