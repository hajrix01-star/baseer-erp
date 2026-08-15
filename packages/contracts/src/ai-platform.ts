import { z } from "zod";

import { companyIdSchema } from "./identity.js";

const aiIdempotencyKeySchema = z.string().trim().min(1).max(255);

export const aiProviderKindSchema = z.enum([
  "OPENAI_COMPATIBLE",
  "ANTHROPIC",
  "GOOGLE_GENERATIVE_AI",
]);

const moneyLimitSchema = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,4})?$/)
  .max(32)
  .optional();

export const configureAiProviderRequestSchema = z
  .object({
    provider: aiProviderKindSchema,
    model: z.string().trim().min(1).max(160),
    apiKey: z.string().min(1).max(20_000),
    dailyRequestLimit: z.number().int().min(1).max(100_000),
    dailyCostLimit: moneyLimitSchema,
    idempotencyKey: aiIdempotencyKeySchema,
  })
  .strict();

export const createAiIdentityRequestSchema = z
  .object({
    displayNameAr: z.string().trim().min(1).max(160),
    displayNameEn: z.string().trim().min(1).max(160),
    defaultLanguage: z.enum(["ar", "en"]),
    toneInstructions: z.string().trim().min(1).max(2_000),
    safetyInstructions: z.string().trim().min(1).max(4_000),
    policyReference: z.string().trim().min(1).max(160).optional(),
    idempotencyKey: aiIdempotencyKeySchema,
  })
  .strict();
export const createAiSystemIdentityRequestSchema = z
  .object({
    assistantNameAr: z.string().trim().min(1).max(80),
    assistantNameEn: z.string().trim().min(1).max(80),
    defaultLanguage: z.enum(["ar", "en"]),
    toneInstructions: z.string().trim().min(1).max(2_000),
    safetyInstructions: z.string().trim().min(1).max(4_000),
    idempotencyKey: aiIdempotencyKeySchema,
  })
  .strict();

export const aiProviderConfigurationReceiptSchema = z
  .object({
    id: z.string().uuid(),
    provider: aiProviderKindSchema,
    model: z.string().min(1).max(160),
    status: z.enum(["ACTIVE", "DISABLED"]),
    dailyRequestLimit: z.number().int().positive(),
    dailyCostLimit: z.string().regex(/^\d+(?:\.\d{1,4})?$/).nullable(),
    configurationVersion: z.number().int().positive(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

export const aiSystemIdentityReceiptSchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    status: z.enum(["ACTIVE", "ARCHIVED"]),
    assistantNameAr: z.string().min(1).max(80),
    assistantNameEn: z.string().min(1).max(80),
    defaultLanguage: z.enum(["ar", "en"]),
    toneInstructions: z.string().min(1).max(2_000),
    safetyInstructions: z.string().min(1).max(4_000),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

export const aiCompanyIdentityReceiptSchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    status: z.enum(["ACTIVE", "ARCHIVED"]),
    displayNameAr: z.string().min(1).max(160),
    displayNameEn: z.string().min(1).max(160),
    defaultLanguage: z.enum(["ar", "en"]),
    toneInstructions: z.string().min(1).max(2_000),
    safetyInstructions: z.string().min(1).max(4_000),
    policyReference: z.string().max(160).nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

export const aiPlatformConfigurationReceiptSchema = z
  .object({
    companyId: companyIdSchema,
    activeProvider: aiProviderConfigurationReceiptSchema.nullable(),
    activeSystemIdentity: aiSystemIdentityReceiptSchema.nullable(),
    activeIdentity: aiCompanyIdentityReceiptSchema.nullable(),
  })
  .strict();

export type ConfigureAiProviderRequest = z.infer<
  typeof configureAiProviderRequestSchema
>;
export type CreateAiIdentityRequest = z.infer<typeof createAiIdentityRequestSchema>;
export type CreateAiSystemIdentityRequest = z.infer<typeof createAiSystemIdentityRequestSchema>;