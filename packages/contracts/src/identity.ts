import { z } from "zod";

export const userIdSchema = z.string().uuid();
export const tenantIdSchema = z.string().uuid();
export const companyIdSchema = z.string().uuid();
export const sessionIdSchema = z.string().uuid();

export const languageSchema = z.enum(["ar", "en"]);
export const sessionTokenTypeSchema = z.enum(["access", "refresh"]);
export const sessionTokenSchema = z.string().min(40).max(8_192);
export const jwtExpirationSchema = z.number().int().positive();

// A short username is resolved by the server inside the private system tenant
// to the system-wide hajrix.com login domain. Email remains the stored identifier.
export const loginIdentifierSchema = z.union([
  z.string().trim().toLowerCase().email().max(254),
  z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9](?:[a-z0-9._-]{1,62}[a-z0-9])?$/),
]);

export const signInRequestSchema = z
  .object({
    login: loginIdentifierSchema,
    password: z.string().min(6).max(256),
  })
  .strict();

// This schema exists only at the sign-in boundary for migrated Noorix bcrypt credentials.
// New-password creation and reset flows retain the stronger signInRequestSchema policy.
export const legacyCompatibleSignInRequestSchema = z
  .object({
    login: loginIdentifierSchema,
    password: z
      .string()
      .min(1)
      .max(256)
      .refine((value) => value.trim().length > 0),
  })
  .strict();

export const tenantCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/);

// All employees sign in using an email or a globally unique short username.
// Tenant and companies are derived by the server from live identity records.
export const activateOwnerRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    activationCode: z.string().min(16).max(256),
    password: z.string().min(6).max(256),
  })
  .strict();
export const refreshSessionRequestSchema = z
  .object({
    refreshToken: sessionTokenSchema,
  })
  .strict();

// The authenticated access-token principal identifies the session to revoke.
// No client-selected session identifier or token secret is accepted here.
export const signOutRequestSchema = z.object({}).strict();

export const selectedCompanyHeaderSchema = companyIdSchema;

export const sessionPrincipalSchema = z
  .object({
    jti: z.string().uuid(),
    sessionId: sessionIdSchema,
    userId: userIdSchema,
    tenantId: tenantIdSchema,
    sessionVersion: z.number().int().nonnegative(),
    tokenType: sessionTokenTypeSchema,
  })
  .strict();

// JWT claims are intentionally limited to session identity and expiry. Company
// membership and permissions must be resolved from authoritative server state.
export const tokenPrincipalSchema = sessionPrincipalSchema
  .extend({
    exp: jwtExpirationSchema,
  })
  .strict();

export const accessTokenPrincipalSchema = tokenPrincipalSchema
  .extend({
    tokenType: z.literal("access"),
  })
  .strict();

export const refreshTokenPrincipalSchema = tokenPrincipalSchema
  .extend({
    tokenType: z.literal("refresh"),
  })
  .strict();

export const sessionUserSchema = z
  .object({
    id: userIdSchema,
    nameAr: z.string().min(1).max(160),
    nameEn: z.string().min(1).max(160),
    preferredLanguage: languageSchema,
  })
  .strict();

export const sessionReceiptSchema = z
  .object({
    accessToken: sessionTokenSchema,
    refreshToken: sessionTokenSchema,
    user: sessionUserSchema,
    sessionExpiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const signOutReceiptSchema = z
  .object({
    signedOut: z.literal(true),
    revokedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const localizedMessageSchema = z
  .object({
    ar: z.string().trim().min(1).max(500),
    en: z.string().trim().min(1).max(500),
  })
  .strict();

export const correlationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const retryGuidanceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("do-not-retry") }).strict(),
  z.object({ kind: z.literal("retry") }).strict(),
  z
    .object({
      kind: z.literal("retry-after"),
      retryAfterSeconds: z.number().int().positive().max(86_400),
    })
    .strict(),
]);

// Codes are deliberately broad: authentication failures must not disclose
// whether a login, user status, session, or token was the reason for rejection.
export const apiErrorCodeSchema = z.enum([
  "VALIDATION_FAILED",
  "AUTHENTICATION_FAILED",
  "AUTHORIZATION_DENIED",
  "NOT_FOUND",
  "CONFLICT",
  "IDEMPOTENCY_MISMATCH",
  "DEPENDENCY_UNAVAILABLE",
  "INTERNAL_ERROR",
  "RATE_LIMITED",
  "REPORT_RUN_EXPIRED",
]);

export const apiErrorReceiptSchema = z
  .object({
    error: z
      .object({
        code: apiErrorCodeSchema,
        message: localizedMessageSchema,
        correlationId: correlationIdSchema,
        retry: retryGuidanceSchema,
      })
      .strict(),
  })
  .strict();

export const activeCompanyReceiptSchema = z
  .object({
    id: companyIdSchema,
    nameAr: z.string().min(1).max(160),
    nameEn: z.string().min(1).max(160),
    // Capability metadata is a UI hint only. Every command is still authorized
    // again by the server against live company membership and role grants.
    permissionCodes: z.array(z.string().min(3).max(120)).max(250),
    // This is an identity attribute, not a permission inference. It lets the
    // shell tailor owner-oriented navigation without granting a capability.
    isOwner: z.boolean().default(false),
  })
  .strict();
export const availableCompaniesReceiptSchema = z
  .object({ companies: z.array(activeCompanyReceiptSchema).min(1).max(250) })
  .strict();

export type SignInRequest = z.infer<typeof signInRequestSchema>;
export type LegacyCompatibleSignInRequest = z.infer<
  typeof legacyCompatibleSignInRequestSchema
>;
export type ActivateOwnerRequest = z.infer<typeof activateOwnerRequestSchema>;
export type RefreshSessionRequest = z.infer<typeof refreshSessionRequestSchema>;
export type SignOutRequest = z.infer<typeof signOutRequestSchema>;
export type SessionPrincipal = z.infer<typeof sessionPrincipalSchema>;
export type TokenPrincipal = z.infer<typeof tokenPrincipalSchema>;
export type AccessTokenPrincipal = z.infer<typeof accessTokenPrincipalSchema>;
export type RefreshTokenPrincipal = z.infer<typeof refreshTokenPrincipalSchema>;
export type SessionReceipt = z.infer<typeof sessionReceiptSchema>;
export type SignOutReceipt = z.infer<typeof signOutReceiptSchema>;
export type LocalizedMessage = z.infer<typeof localizedMessageSchema>;
export type RetryGuidance = z.infer<typeof retryGuidanceSchema>;
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiErrorReceipt = z.infer<typeof apiErrorReceiptSchema>;
export type ActiveCompanyReceipt = z.infer<typeof activeCompanyReceiptSchema>;
