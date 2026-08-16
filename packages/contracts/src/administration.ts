import { z } from "zod";

import { companyIdSchema, languageSchema, loginIdentifierSchema, userIdSchema } from "./identity.js";

const text160 = z.string().trim().min(1).max(160);
const roleCode = z.string().trim().min(3).max(80).regex(/^[A-Z][A-Z0-9_]*$/);
const permissionCode = z.string().trim().min(3).max(120).regex(/^[a-z][a-z0-9._-]*$/);
const password = z.string().min(6).max(256).refine((value) => value.trim().length > 0);
const userAvatarKind = z.enum(["INITIALS", "MALE", "FEMALE"]);

export const administrationPermissionSchema = z.object({
  code: permissionCode, module: z.string().min(1).max(80), nameAr: text160, nameEn: text160, risk: z.enum(["standard", "sensitive"]),
}).strict();
export const administrationRoleSchema = z.object({
  id: z.string().uuid(), code: roleCode, nameAr: text160, nameEn: text160, isSystem: z.boolean(), permissionCodes: z.array(permissionCode).max(120),
}).strict();
export const administrationCompanySchema = z.object({
  id: companyIdSchema, nameAr: text160, nameEn: text160, businessTimezone: z.string().min(1).max(64), status: z.enum(["ACTIVE", "ARCHIVED"]), logoFileMetadataId: z.string().uuid().nullable(),
}).strict();
export const administrationUserSchema = z.object({
  id: userIdSchema, login: loginIdentifierSchema, nameAr: text160, nameEn: text160, preferredLanguage: languageSchema, avatarKind: userAvatarKind, status: z.enum(["ACTIVE", "DISABLED"]), memberships: z.array(z.object({ companyId: companyIdSchema, companyNameAr: text160, companyNameEn: text160, roleId: z.string().uuid(), roleNameAr: text160, roleNameEn: text160 }).strict()).max(250),
}).strict();
export const administrationOverviewReceiptSchema = z.object({ companies: z.array(administrationCompanySchema).max(250), users: z.array(administrationUserSchema).max(500), roles: z.array(administrationRoleSchema).max(250), permissions: z.array(administrationPermissionSchema), owner: z.boolean() }).strict();
export const createAdministrationCompanyRequestSchema = z.object({ nameAr: text160, nameEn: text160, businessTimezone: z.string().trim().min(1).max(64).default("Asia/Riyadh") }).strict();
export const createAdministrationRoleRequestSchema = z.object({ code: roleCode, nameAr: text160, nameEn: text160, permissionCodes: z.array(permissionCode).min(1).max(120) }).strict();
export const createAdministrationUserRequestSchema = z.object({ login: loginIdentifierSchema, nameAr: text160, nameEn: text160, preferredLanguage: languageSchema.default("ar"), avatarKind: userAvatarKind.default("INITIALS"), password, companyId: companyIdSchema, roleId: z.string().uuid() }).strict();
export const assignAdministrationMembershipRequestSchema = z.object({ userId: userIdSchema, companyId: companyIdSchema, roleId: z.string().uuid() }).strict();
export const updateAdministrationCompanyRequestSchema = z.object({ nameAr: text160, nameEn: text160, businessTimezone: z.string().trim().min(1).max(64), logoFileMetadataId: z.string().uuid().nullable() }).strict();
export const updateAdministrationUserStatusRequestSchema = z.object({ status: z.enum(["ACTIVE", "DISABLED"]), reason: z.string().trim().min(3).max(500) }).strict();
export const resetAdministrationUserPasswordRequestSchema = z.object({ password, reason: z.string().trim().min(3).max(500) }).strict();
export const withdrawAdministrationMembershipRequestSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

export type CreateAdministrationCompanyRequest = z.infer<typeof createAdministrationCompanyRequestSchema>;
export type CreateAdministrationRoleRequest = z.infer<typeof createAdministrationRoleRequestSchema>;
export type CreateAdministrationUserRequest = z.infer<typeof createAdministrationUserRequestSchema>;
export type AssignAdministrationMembershipRequest = z.infer<typeof assignAdministrationMembershipRequestSchema>;
export type UpdateAdministrationCompanyRequest = z.infer<typeof updateAdministrationCompanyRequestSchema>;
export type UpdateAdministrationUserStatusRequest = z.infer<typeof updateAdministrationUserStatusRequestSchema>;
export type ResetAdministrationUserPasswordRequest = z.infer<typeof resetAdministrationUserPasswordRequestSchema>;
export type WithdrawAdministrationMembershipRequest = z.infer<typeof withdrawAdministrationMembershipRequestSchema>;
