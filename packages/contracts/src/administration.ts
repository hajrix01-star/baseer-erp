import { z } from "zod";

import { companyIdSchema, languageSchema, loginIdentifierSchema, userIdSchema } from "./identity.js";

const text160 = z.string().trim().min(1).max(160);
const roleCode = z.string().trim().min(3).max(80).regex(/^[A-Z][A-Z0-9_]*$/);
const permissionCode = z.string().trim().min(3).max(120).regex(/^[a-z][a-z0-9._-]*$/);
const password = z.string().min(6).max(256).refine((value) => value.trim().length > 0);
const safeFileNameSchema = z.string().trim().min(1).max(160).refine((value) => !/[\\/\x00-\x1F]/.test(value));
const userAvatarKind = z.enum(["INITIALS", "MALE", "FEMALE"]);
const companyLogoContentBase64 = z.string().trim().min(4).max(700_000).regex(/^[A-Za-z0-9+/]+={0,2}$/);
const contextLocationCode = z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9_-]+$/).transform((value) => value.toUpperCase());
const coordinate = z.number().finite();

/**
 * The canonical locations available to a company in the first decision-context
 * rollout. Coordinates are controlled by the server; clients select a city,
 * rather than submitting an arbitrary point that could misclassify local context.
 */
export const COMPANY_CONTEXT_LOCATIONS = [
  { code: "RIYADH", labelAr: "الرياض", labelEn: "Riyadh", latitude: 24.7136, longitude: 46.6753 },
  { code: "JEDDAH", labelAr: "جدة", labelEn: "Jeddah", latitude: 21.4858, longitude: 39.1925 },
  { code: "DAMMAM", labelAr: "الدمام", labelEn: "Dammam", latitude: 26.4207, longitude: 50.0888 },
  { code: "KHOBAR", labelAr: "الخبر", labelEn: "Al Khobar", latitude: 26.2172, longitude: 50.1971 },
] as const;

export const companyContextLocationByCode = (code: string | null) => COMPANY_CONTEXT_LOCATIONS.find((location) => location.code === code) ?? null;

const companyContextLocationFields = {
  contextLocationCode: contextLocationCode.nullable(),
  contextLocationLabelAr: z.string().trim().min(2).max(160).nullable(),
  contextLatitude: coordinate.min(-90).max(90).nullable(),
  contextLongitude: coordinate.min(-180).max(180).nullable(),
};

export const administrationPermissionSchema = z.object({
  code: permissionCode, module: z.string().min(1).max(80), moduleAr: text160, moduleEn: text160, sectionAr: text160, sectionEn: text160, nameAr: text160, nameEn: text160, risk: z.enum(["standard", "sensitive"]), requires: z.array(permissionCode).max(120),
}).strict();
export const administrationRoleSchema = z.object({
  id: z.string().uuid(), code: roleCode, nameAr: text160, nameEn: text160, isSystem: z.boolean(), permissionCodes: z.array(permissionCode).max(120),
}).strict();
export const administrationCompanySchema = z.object({
  id: companyIdSchema, nameAr: text160, nameEn: text160, businessTimezone: z.string().min(1).max(64), status: z.enum(["ACTIVE", "ARCHIVED"]), migrationReviewLocked: z.boolean(), logoFileMetadataId: z.string().uuid().nullable(), ...companyContextLocationFields,
}).strict();
export const administrationUserSchema = z.object({
  id: userIdSchema, login: loginIdentifierSchema, nameAr: text160, nameEn: text160, preferredLanguage: languageSchema, avatarKind: userAvatarKind, status: z.enum(["ACTIVE", "DISABLED"]), isOwner: z.boolean(), memberships: z.array(z.object({ companyId: companyIdSchema, companyNameAr: text160, companyNameEn: text160, roleId: z.string().uuid(), roleNameAr: text160, roleNameEn: text160 }).strict()).max(250),
}).strict();
export const administrationOverviewReceiptSchema = z.object({ companies: z.array(administrationCompanySchema).max(250), users: z.array(administrationUserSchema).max(500), roles: z.array(administrationRoleSchema).max(250), permissions: z.array(administrationPermissionSchema), owner: z.boolean() }).strict();
export const createAdministrationCompanyRequestSchema = z.object({ nameAr: text160, nameEn: text160, businessTimezone: z.string().trim().min(1).max(64).default("Asia/Riyadh") }).strict();
export const createAdministrationRoleRequestSchema = z.object({ code: roleCode.optional(), nameAr: text160, nameEn: text160, permissionCodes: z.array(permissionCode).min(1).max(120) }).strict();
export const createAdministrationUserRequestSchema = z.object({ login: loginIdentifierSchema, nameAr: text160, nameEn: text160, preferredLanguage: languageSchema.default("ar"), avatarKind: userAvatarKind.default("INITIALS"), password, companyIds: z.array(companyIdSchema).min(1).max(250).refine((values) => new Set(values).size === values.length), roleId: z.string().uuid() }).strict();
export const assignAdministrationMembershipRequestSchema = z.object({ userId: userIdSchema, companyId: companyIdSchema, roleId: z.string().uuid() }).strict();
export const replaceAdministrationUserAccessRequestSchema = z.object({ roleId: z.string().uuid(), companyIds: z.array(companyIdSchema).min(1).max(250).refine((values) => new Set(values).size === values.length), reason: z.string().trim().min(3).max(500) }).strict();
export const updateAdministrationCompanyRequestSchema = z.object({ nameAr: text160, nameEn: text160, businessTimezone: z.string().trim().min(1).max(64), logoFileMetadataId: z.string().uuid().nullable(), vatRateBasisPoints: z.number().int().min(0).max(10_000).optional(), ...companyContextLocationFields }).strict().superRefine((value, context) => {
  const hasCode = value.contextLocationCode !== null;
  const hasLabel = value.contextLocationLabelAr !== null;
  const hasLatitude = value.contextLatitude !== null;
  const hasLongitude = value.contextLongitude !== null;
  if (hasCode !== hasLabel) context.addIssue({ code: "custom", message: "Context location code and label must be supplied together." });
  if (hasLatitude !== hasLongitude) context.addIssue({ code: "custom", message: "Context latitude and longitude must be supplied together." });
  if (hasLatitude && !hasCode) context.addIssue({ code: "custom", message: "Coordinates require a context location." });
  if (!hasCode) return;
  const location = companyContextLocationByCode(value.contextLocationCode);
  if (!location) {
    context.addIssue({ code: "custom", message: "Context location is not in the approved catalog." });
    return;
  }
  if (value.contextLocationLabelAr !== location.labelAr || value.contextLatitude !== location.latitude || value.contextLongitude !== location.longitude) {
    context.addIssue({ code: "custom", message: "Context location metadata must match the approved catalog." });
  }
});
export const uploadAdministrationCompanyLogoRequestSchema = z.object({ fileName: safeFileNameSchema, contentBase64: companyLogoContentBase64 }).strict();
export const updateAdministrationCompanyStatusRequestSchema = z.object({ status: z.enum(["ACTIVE", "ARCHIVED"]), reason: z.string().trim().min(3).max(500).optional() }).strict();
export const updateAdministrationCompanyMigrationReviewLockRequestSchema = z.object({ locked: z.boolean(), reason: z.string().trim().min(3).max(500) }).strict();
export const updateAdministrationRoleRequestSchema = z.object({ nameAr: text160, nameEn: text160, permissionCodes: z.array(permissionCode).min(1).max(120) }).strict();
export const deleteAdministrationRoleRequestSchema = z.object({}).strict();
export const updateAdministrationUserLoginRequestSchema = z.object({ login: loginIdentifierSchema, reason: z.string().trim().min(3).max(500) }).strict();
export const updateAdministrationUserDisplayNameRequestSchema = z.object({ nameAr: text160, nameEn: text160, reason: z.string().trim().min(3).max(500) }).strict();
export const updateAdministrationUserStatusRequestSchema = z.object({ status: z.enum(["ACTIVE", "DISABLED"]), reason: z.string().trim().min(3).max(500) }).strict();
export const resetAdministrationUserPasswordRequestSchema = z.object({ password, reason: z.string().trim().min(3).max(500) }).strict();
export const withdrawAdministrationMembershipRequestSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

export type CreateAdministrationCompanyRequest = z.infer<typeof createAdministrationCompanyRequestSchema>;
export type CreateAdministrationRoleRequest = z.infer<typeof createAdministrationRoleRequestSchema>;
export type CreateAdministrationUserRequest = z.infer<typeof createAdministrationUserRequestSchema>;
export type AssignAdministrationMembershipRequest = z.infer<typeof assignAdministrationMembershipRequestSchema>;
export type ReplaceAdministrationUserAccessRequest = z.infer<typeof replaceAdministrationUserAccessRequestSchema>;
export type UpdateAdministrationCompanyRequest = z.infer<typeof updateAdministrationCompanyRequestSchema>;
export type UploadAdministrationCompanyLogoRequest = z.infer<typeof uploadAdministrationCompanyLogoRequestSchema>;
export type UpdateAdministrationRoleRequest = z.infer<typeof updateAdministrationRoleRequestSchema>;
export type DeleteAdministrationRoleRequest = z.infer<typeof deleteAdministrationRoleRequestSchema>;
export type UpdateAdministrationCompanyStatusRequest = z.infer<typeof updateAdministrationCompanyStatusRequestSchema>;
export type UpdateAdministrationCompanyMigrationReviewLockRequest = z.infer<typeof updateAdministrationCompanyMigrationReviewLockRequestSchema>;
export type UpdateAdministrationUserLoginRequest = z.infer<typeof updateAdministrationUserLoginRequestSchema>;
export type UpdateAdministrationUserDisplayNameRequest = z.infer<typeof updateAdministrationUserDisplayNameRequestSchema>;
export type UpdateAdministrationUserStatusRequest = z.infer<typeof updateAdministrationUserStatusRequestSchema>;
export type ResetAdministrationUserPasswordRequest = z.infer<typeof resetAdministrationUserPasswordRequestSchema>;
export type WithdrawAdministrationMembershipRequest = z.infer<typeof withdrawAdministrationMembershipRequestSchema>;
