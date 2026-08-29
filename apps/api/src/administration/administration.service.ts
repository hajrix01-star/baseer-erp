import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { companyContextLocationByCode, type AssignAdministrationMembershipRequest, type CreateAdministrationCompanyRequest, type CreateAdministrationRoleRequest, type CreateAdministrationUserRequest, type ResetAdministrationUserPasswordRequest, type ReplaceAdministrationUserAccessRequest, type UpdateAdministrationCompanyMigrationReviewLockRequest, type UpdateAdministrationCompanyRequest, type UpdateAdministrationCompanyStatusRequest, type UpdateAdministrationRoleRequest, type UpdateAdministrationUserLoginRequest, type UpdateAdministrationUserDisplayNameRequest, type UploadAdministrationCompanyLogoRequest, type UpdateAdministrationUserStatusRequest, type WithdrawAdministrationMembershipRequest } from "@baseer-erp/contracts";
import { CompanyStatus, FileMetadataStatus, Prisma, SessionStatus, UserStatus } from "../generated/prisma/client.js";
import { DatabaseService } from "../database/database.service.js";
import { hashPassword } from "../identity/password.util.js";
import { displayLoginIdentifier, normalizeLoginIdentifier } from "../identity/login-identifier.js";
import { RequestContext } from "../observability/request-context.js";
import { ADMINISTRATION_PERMISSION_CATALOG, permissionCodesAreKnown, SYSTEM_ROLE_TEMPLATES } from "./administration-permissions.js";
import type { TrustedTenantAdministratorContext } from "./tenant-administration-context.service.js";

@Injectable()
export class AdministrationService {
  constructor(private readonly database: DatabaseService) {}

  async overview(context: TrustedTenantAdministratorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      // Loading the administration overview is a read operation. System-role
      // bootstrapping belongs to explicit administration commands, never to a
      // page view that should work with read-only database credentials.
      const [tenant, companies, users, roles] = await Promise.all([
        tx.tenant.findFirstOrThrow({ where: { id: context.tenantId }, select: { code: true } }),
        tx.company.findMany({ orderBy: { nameAr: "asc" }, take: 250, include: { branding: { select: { logoFileMetadataId: true } } } }),
        tx.user.findMany({ orderBy: { nameAr: "asc" }, take: 500, include: { memberships: { where: { company: { status: CompanyStatus.ACTIVE } }, include: { company: true, role: true }, orderBy: { company: { nameAr: "asc" } } }, tenantAdministrationAssignments: { where: { isOwner: true }, select: { isOwner: true } } } }),
        tx.role.findMany({ orderBy: [{ isSystem: "desc" }, { nameAr: "asc" }], take: 250, include: { grants: { orderBy: { permissionCode: "asc" } } } }),
      ]);
      return {
        owner: context.isOwner,
        permissions: ADMINISTRATION_PERMISSION_CATALOG,
        companies: companies.map((company) => ({ id: company.id, nameAr: company.nameAr, nameEn: company.nameEn, businessTimezone: company.businessTimezone, status: company.status, migrationReviewLocked: company.migrationReviewLocked, logoFileMetadataId: company.branding?.logoFileMetadataId ?? null, contextLocationCode: company.contextLocationCode, contextLocationLabelAr: company.contextLocationLabelAr, contextLatitude: company.contextLatitude?.toString() ? Number(company.contextLatitude.toString()) : null, contextLongitude: company.contextLongitude?.toString() ? Number(company.contextLongitude.toString()) : null })),
        users: users.map((user) => ({ id: user.id, login: displayLoginIdentifier(user.loginNormalized, tenant.code), nameAr: user.nameAr, nameEn: user.nameEn, preferredLanguage: user.preferredLanguage, avatarKind: user.avatarKind as "INITIALS" | "MALE" | "FEMALE", status: user.status, isOwner: user.tenantAdministrationAssignments.some((assignment) => assignment.isOwner), memberships: user.memberships.map((membership) => ({ companyId: membership.companyId, companyNameAr: membership.company.nameAr, companyNameEn: membership.company.nameEn, roleId: membership.roleId, roleNameAr: membership.role.nameAr, roleNameEn: membership.role.nameEn })) })),
        roles: roles.map((role) => ({ id: role.id, code: role.code, nameAr: role.nameAr, nameEn: role.nameEn, isSystem: role.isSystem, permissionCodes: role.grants.map((grant) => grant.permissionCode) })),
      };
    });
  }

  async createCompany(context: TrustedTenantAdministratorContext, request: CreateAdministrationCompanyRequest) {
    this.ownerOnly(context);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.ensureSystemRoles(tx, context.tenantId);
      const manager = await tx.role.findFirst({ where: { tenantId: context.tenantId, code: "BASEER_COMPANY_MANAGER" } });
      if (!manager) throw new ConflictException("Company-manager role was not initialized.");
      const id = randomUUID();
      await tx.company.create({ data: { id, tenantId: context.tenantId, nameAr: request.nameAr, nameEn: request.nameEn, businessTimezone: request.businessTimezone } });
      await tx.companyBranding.create({ data: { tenantId: context.tenantId, companyId: id } });
      await tx.companyMembership.upsert({ where: { userId_companyId: { userId: context.actorUserId, companyId: id } }, create: { tenantId: context.tenantId, userId: context.actorUserId, companyId: id, roleId: manager.id }, update: { roleId: manager.id } });
      await this.audit(tx, context, "administration.company.created", "Company", id, null, { nameAr: request.nameAr, nameEn: request.nameEn, businessTimezone: request.businessTimezone });
      return { id };
    });
  }
  async createRole(context: TrustedTenantAdministratorContext, request: CreateAdministrationRoleRequest) {
    this.ownerOnly(context); if (!permissionCodesAreKnown(request.permissionCodes)) throw new ForbiddenException("Unknown permission selection.");
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.ensureSystemRoles(tx, context.tenantId);
      const existing = await tx.role.findFirst({ where: { tenantId: context.tenantId, code: request.code } }); if (existing) throw new ConflictException("Role code already exists.");
      const id = randomUUID();
      await tx.role.create({ data: { id, tenantId: context.tenantId, code: request.code, nameAr: request.nameAr, nameEn: request.nameEn, isSystem: false, grants: { createMany: { data: [...new Set(request.permissionCodes)].map((permissionCode) => ({ tenantId: context.tenantId, permissionCode })) } } } });
      await this.audit(tx, context, "administration.role.created", "Role", id, null, { code: request.code, permissionCodes: [...new Set(request.permissionCodes)] });
      return { id };
    });
  }

  async updateRole(context: TrustedTenantAdministratorContext, roleId: string, request: UpdateAdministrationRoleRequest) {
    this.ownerOnly(context);
    if (!permissionCodesAreKnown(request.permissionCodes)) throw new ForbiddenException("Unknown permission selection.");
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const role = await tx.role.findFirst({ where: { id: roleId, tenantId: context.tenantId }, include: { grants: true } });
      if (!role) throw new NotFoundException("Role was not found.");
      const permissionCodes: string[] = [...new Set(request.permissionCodes)];
      await tx.role.update({ where: { id: role.id }, data: { nameAr: request.nameAr, nameEn: request.nameEn } });
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.rolePermission.createMany({ data: permissionCodes.map((permissionCode) => ({ tenantId: context.tenantId, roleId: role.id, permissionCode })) });
      await this.audit(tx, context, "administration.role.updated", "Role", role.id, { nameAr: role.nameAr, nameEn: role.nameEn, permissionCodes: role.grants.map((grant) => grant.permissionCode) }, { nameAr: request.nameAr, nameEn: request.nameEn, permissionCodes });
      return { updated: true };
    });
  }

  async deleteRole(context: TrustedTenantAdministratorContext, roleId: string) {
    this.ownerOnly(context);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const role = await tx.role.findFirst({ where: { id: roleId, tenantId: context.tenantId }, select: { id: true, code: true, nameAr: true } });
      if (!role) throw new NotFoundException("Role was not found.");
      if (await tx.companyMembership.count({ where: { tenantId: context.tenantId, roleId: role.id } })) throw new ConflictException("Reassign members before deleting this role.");
      await tx.role.delete({ where: { id: role.id } });
      await this.audit(tx, context, "administration.role.deleted", "Role", role.id, { code: role.code, nameAr: role.nameAr }, { deleted: true });
      return { deleted: true };
    });
  }

  async createUser(context: TrustedTenantAdministratorContext, request: CreateAdministrationUserRequest) {
    this.ownerOnly(context); const passwordHash = await hashPassword(request.password);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.ensureSystemRoles(tx, context.tenantId);
      const tenant = await tx.tenant.findFirstOrThrow({ where: { id: context.tenantId }, select: { code: true } });
      const loginNormalized = normalizeLoginIdentifier(request.login, tenant.code);
      const [companies, role, existing] = await Promise.all([
        tx.company.findMany({ where: { id: { in: request.companyIds }, tenantId: context.tenantId, status: CompanyStatus.ACTIVE }, select: { id: true } }),
        tx.role.findFirst({ where: { id: request.roleId, tenantId: context.tenantId } }),
        tx.user.findFirst({ where: { tenantId: context.tenantId, loginNormalized } }),
      ]);
      if (companies.length !== request.companyIds.length || !role) throw new NotFoundException("Company or role was not found."); if (existing) throw new ConflictException("User login already exists.");
      const id = randomUUID();
      await tx.user.create({ data: { id, tenantId: context.tenantId, loginNormalized, nameAr: request.nameAr, nameEn: request.nameEn, preferredLanguage: request.preferredLanguage, avatarKind: request.avatarKind, passwordHash } });
      await tx.companyMembership.createMany({ data: companies.map((company) => ({ tenantId: context.tenantId, userId: id, companyId: company.id, roleId: role.id })) });
      await this.audit(tx, context, "administration.user.created", "User", id, null, { companyIds: companies.map((company) => company.id), roleId: role.id }); return { id };
    });
  }
  async assignMembership(context: TrustedTenantAdministratorContext, request: AssignAdministrationMembershipRequest) {
    this.ownerOnly(context);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const [user, company, role] = await Promise.all([tx.user.findFirst({ where: { id: request.userId, tenantId: context.tenantId } }), tx.company.findFirst({ where: { id: request.companyId, tenantId: context.tenantId, status: CompanyStatus.ACTIVE } }), tx.role.findFirst({ where: { id: request.roleId, tenantId: context.tenantId } })]);
      if (!user || !company || !role) throw new NotFoundException("User, company, or role was not found.");
      const prior = await tx.companyMembership.findFirst({ where: { tenantId: context.tenantId, userId: user.id, companyId: company.id }, select: { roleId: true } });
      await tx.companyMembership.upsert({ where: { userId_companyId: { userId: user.id, companyId: company.id } }, create: { tenantId: context.tenantId, userId: user.id, companyId: company.id, roleId: role.id }, update: { roleId: role.id } });
      await tx.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
      await this.revokeUserSessions(tx, context.tenantId, user.id);
      await this.audit(tx, context, "administration.membership.assigned", "CompanyMembership", `${user.id}:${company.id}`, prior, { roleId: role.id }); return { assigned: true };
    });
  }

  async updateUserLogin(context: TrustedTenantAdministratorContext, userId: string, request: UpdateAdministrationUserLoginRequest) {
    this.ownerOnly(context);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const tenant = await tx.tenant.findFirstOrThrow({ where: { id: context.tenantId }, select: { code: true } });
      const loginNormalized = normalizeLoginIdentifier(request.login, tenant.code);
      const [user, existing] = await Promise.all([
        tx.user.findFirst({ where: { id: userId, tenantId: context.tenantId }, select: { id: true, loginNormalized: true } }),
        tx.user.findFirst({ where: { tenantId: context.tenantId, loginNormalized }, select: { id: true } }),
      ]);
      if (!user) throw new NotFoundException("User was not found.");
      if (existing && existing.id !== user.id) throw new ConflictException("User login already exists.");
      if (user.loginNormalized === loginNormalized) return { updated: true };
      await tx.user.update({ where: { id: user.id }, data: { loginNormalized } });
      await this.audit(tx, context, "administration.user.login_updated", "User", user.id, { login: displayLoginIdentifier(user.loginNormalized, tenant.code) }, { login: displayLoginIdentifier(loginNormalized, tenant.code), reason: request.reason });
      return { updated: true };
    });
  }
  async updateUserDisplayName(context: TrustedTenantAdministratorContext, userId: string, request: UpdateAdministrationUserDisplayNameRequest) {
    this.ownerOnly(context);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const user = await tx.user.findFirst({ where: { id: userId, tenantId: context.tenantId }, select: { id: true, nameAr: true, nameEn: true } });
      if (!user) throw new NotFoundException("User was not found.");
      if (user.nameAr === request.nameAr && user.nameEn === request.nameEn) return { updated: true };
      await tx.user.update({ where: { id: user.id }, data: { nameAr: request.nameAr, nameEn: request.nameEn } });
      await this.audit(tx, context, "administration.user.display_name_updated", "User", user.id, { nameAr: user.nameAr, nameEn: user.nameEn }, { nameAr: request.nameAr, nameEn: request.nameEn, reason: request.reason });
      return { updated: true };
    });
  }  async replaceUserAccess(context: TrustedTenantAdministratorContext, userId: string, request: ReplaceAdministrationUserAccessRequest) {
    this.ownerOnly(context);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const [user, role, companies, prior] = await Promise.all([
        tx.user.findFirst({ where: { id: userId, tenantId: context.tenantId }, select: { id: true } }),
        tx.role.findFirst({ where: { id: request.roleId, tenantId: context.tenantId }, select: { id: true } }),
        tx.company.findMany({ where: { id: { in: request.companyIds }, tenantId: context.tenantId, status: CompanyStatus.ACTIVE }, select: { id: true } }),
        tx.companyMembership.findMany({ where: { tenantId: context.tenantId, userId }, select: { companyId: true, roleId: true } }),
      ]);
      if (!user || !role || companies.length !== request.companyIds.length) throw new NotFoundException("User, company, or role was not found.");
      await tx.companyMembership.deleteMany({ where: { tenantId: context.tenantId, userId } });
      await tx.companyMembership.createMany({ data: companies.map((company) => ({ tenantId: context.tenantId, userId, companyId: company.id, roleId: role.id })) });
      await tx.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
      await this.revokeUserSessions(tx, context.tenantId, userId);
      await this.audit(tx, context, "administration.user.access_replaced", "User", userId, { memberships: prior }, { companyIds: companies.map((company) => company.id), roleId: role.id, reason: request.reason });
      return { updated: true };
    });
  }
  async updateUserStatus(context: TrustedTenantAdministratorContext, userId: string, request: UpdateAdministrationUserStatusRequest) {
    this.ownerOnly(context);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const user = await tx.user.findFirst({ where: { id: userId, tenantId: context.tenantId }, select: { id: true, status: true } });
      if (!user) throw new NotFoundException("User was not found.");
      if (user.status === request.status) return { updated: true, status: user.status };
      if (request.status === UserStatus.DISABLED) await this.assertAnotherActiveOwner(tx, context.tenantId, user.id);
      await tx.user.update({ where: { id: user.id }, data: { status: request.status, sessionVersion: { increment: 1 } } });
      await this.revokeUserSessions(tx, context.tenantId, user.id);
      await this.audit(tx, context, "administration.user.status_changed", "User", user.id, { status: user.status }, { status: request.status, reason: request.reason });
      return { updated: true, status: request.status };
    });
  }

  async resetUserPassword(context: TrustedTenantAdministratorContext, userId: string, request: ResetAdministrationUserPasswordRequest) {
    this.ownerOnly(context);
    const passwordHash = await hashPassword(request.password);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const user = await tx.user.findFirst({ where: { id: userId, tenantId: context.tenantId }, select: { id: true, status: true } });
      if (!user) throw new NotFoundException("User was not found.");
      if (user.status !== UserStatus.ACTIVE) throw new ConflictException("A disabled user cannot receive a password reset.");
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, sessionVersion: { increment: 1 } } });
      await this.revokeUserSessions(tx, context.tenantId, user.id);
      await this.audit(tx, context, "administration.user.password_reset", "User", user.id, null, { reset: true, reason: request.reason });
      return { reset: true };
    });
  }

  async withdrawMembership(context: TrustedTenantAdministratorContext, userId: string, companyId: string, request: WithdrawAdministrationMembershipRequest) {
    this.ownerOnly(context);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const membership = await tx.companyMembership.findFirst({ where: { tenantId: context.tenantId, userId, companyId }, select: { userId: true, companyId: true, roleId: true } });
      if (!membership) throw new NotFoundException("Company membership was not found.");
      await tx.companyMembership.delete({ where: { userId_companyId: { userId, companyId } } });
      await this.revokeUserSessions(tx, context.tenantId, userId);
      await this.audit(tx, context, "administration.membership.withdrawn", "CompanyMembership", `${userId}:${companyId}`, { roleId: membership.roleId }, { withdrawn: true, reason: request.reason });
      return { withdrawn: true };
    });
  }
  async updateCompany(context: TrustedTenantAdministratorContext, companyId: string, request: UpdateAdministrationCompanyRequest) {
    this.ownerOnly(context);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const company = await tx.company.findFirst({ where: { id: companyId, tenantId: context.tenantId }, include: { branding: { select: { logoFileMetadataId: true } } } }); if (!company) throw new NotFoundException("Company was not found.");
      if (request.logoFileMetadataId) { const logo = await tx.fileMetadata.findFirst({ where: { id: request.logoFileMetadataId, tenantId: context.tenantId, companyId, status: FileMetadataStatus.RESERVED, sourceType: "company.branding", sourceId: companyId, purpose: "logo" } }); if (!logo || !logo.declaredMimeType.startsWith("image/")) throw new ForbiddenException("Company logo file is not permitted."); }
      const location = companyContextLocationByCode(request.contextLocationCode);
      if (request.contextLocationCode && !location) throw new ForbiddenException("Company context location is not approved.");
      const next = {
        nameAr: request.nameAr,
        nameEn: request.nameEn,
        businessTimezone: request.businessTimezone,
        logoFileMetadataId: request.logoFileMetadataId,
        contextLocationCode: location?.code ?? null,
        contextLocationLabelAr: location?.labelAr ?? null,
        contextLatitude: location?.latitude ?? null,
        contextLongitude: location?.longitude ?? null,
      };
      await tx.company.update({ where: { id: companyId }, data: { nameAr: next.nameAr, nameEn: next.nameEn, businessTimezone: next.businessTimezone, contextLocationCode: next.contextLocationCode, contextLocationLabelAr: next.contextLocationLabelAr, contextLatitude: next.contextLatitude === null ? null : new Prisma.Decimal(next.contextLatitude), contextLongitude: next.contextLongitude === null ? null : new Prisma.Decimal(next.contextLongitude) } });
      await tx.companyBranding.upsert({ where: { tenantId_companyId: { tenantId: context.tenantId, companyId } }, create: { tenantId: context.tenantId, companyId, logoFileMetadataId: request.logoFileMetadataId }, update: { logoFileMetadataId: request.logoFileMetadataId } });
      await this.audit(tx, context, "administration.company.settings_updated", "Company", companyId, {
        nameAr: company.nameAr,
        nameEn: company.nameEn,
        businessTimezone: company.businessTimezone,
        logoFileMetadataId: company.branding?.logoFileMetadataId ?? null,
        contextLocationCode: company.contextLocationCode,
        contextLocationLabelAr: company.contextLocationLabelAr,
        contextLatitude: company.contextLatitude?.toString() ?? null,
        contextLongitude: company.contextLongitude?.toString() ?? null,
      }, next);
      return { updated: true };
    });
  }

  async uploadCompanyLogo(context: TrustedTenantAdministratorContext, companyId: string, request: UploadAdministrationCompanyLogoRequest) {
    this.ownerOnly(context);
    const content = Buffer.from(request.contentBase64, "base64");
    if (!content.length || content.length > 512 * 1024) throw new ForbiddenException("Company logo size is not permitted.");
    const image = this.companyLogoImageType(content);
    if (!image) throw new ForbiddenException("Company logo must be a PNG, JPEG, or WebP image.");
    const fileId = randomUUID();
    const storageReference = `company-branding/${context.tenantId}/${companyId}/${fileId}.${image.extension}`;
    const target = this.companyLogoStoragePath(storageReference);
    const temporary = `${target}.${randomUUID()}.uploading`;
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(temporary, content, { flag: "wx" });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    try {
      const result = await this.database.inTenantTransaction(context.tenantId, async (tx) => {
        const company = await tx.company.findFirst({ where: { id: companyId, tenantId: context.tenantId }, select: { id: true } });
        if (!company) throw new NotFoundException("Company was not found.");
        const existing = await tx.companyBranding.findFirst({ where: { tenantId: context.tenantId, companyId }, select: { logoFileMetadataId: true } });
        const [prior, history] = await Promise.all([
          existing?.logoFileMetadataId ? tx.fileMetadata.findFirst({ where: { id: existing.logoFileMetadataId, tenantId: context.tenantId, companyId }, select: { id: true, storageReference: true } }) : null,
          tx.fileMetadata.aggregate({ where: { tenantId: context.tenantId, companyId, sourceType: "company.branding", sourceId: companyId, purpose: "logo" }, _max: { version: true } }),
        ]);
        const created = await tx.fileMetadata.create({ data: { id: fileId, tenantId: context.tenantId, companyId, sourceType: "company.branding", sourceId: companyId, purpose: "logo", version: (history._max.version ?? 0) + 1, status: FileMetadataStatus.RESERVED, displayName: request.fileName, declaredMimeType: image.mime, declaredByteSize: BigInt(content.length), declaredSha256: createHash("sha256").update(content).digest("hex"), storageReference, replacesFileMetadataId: prior?.id ?? null, createdByUserId: context.actorUserId } });
        await tx.companyBranding.upsert({ where: { tenantId_companyId: { tenantId: context.tenantId, companyId } }, create: { tenantId: context.tenantId, companyId, logoFileMetadataId: created.id }, update: { logoFileMetadataId: created.id } });
        if (prior) await tx.fileMetadata.update({ where: { id: prior.id }, data: { status: FileMetadataStatus.SUPERSEDED, supersededAt: new Date() } });
        await this.audit(tx, context, "administration.company.logo_uploaded", "Company", companyId, prior ? { logoFileMetadataId: prior.id } : null, { logoFileMetadataId: created.id, mimeType: image.mime, byteSize: content.length, sha256: created.declaredSha256 });
        return { id: created.id, mimeType: image.mime, byteSize: content.length };
      });
      return { id: result.id, mimeType: result.mimeType, byteSize: result.byteSize };
    } catch (error) {
      await rm(target, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async readCompanyLogo(context: TrustedTenantAdministratorContext, companyId: string) {
    this.ownerOnly(context);
    const file = await this.database.inTenantTransaction(context.tenantId, async (tx) => tx.fileMetadata.findFirst({ where: { tenantId: context.tenantId, companyId, sourceType: "company.branding", sourceId: companyId, purpose: "logo", status: FileMetadataStatus.RESERVED }, select: { declaredMimeType: true, storageReference: true } }));
    if (!file) throw new NotFoundException("Company logo was not found.");
    try { return { mimeType: file.declaredMimeType, bytes: await readFile(this.companyLogoStoragePath(file.storageReference)) }; }
    catch { throw new NotFoundException("Company logo was not found."); }
  }
  async updateCompanyStatus(context: TrustedTenantAdministratorContext, companyId: string, request: UpdateAdministrationCompanyStatusRequest) {
    this.ownerOnly(context);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const company = await tx.company.findFirst({ where: { id: companyId, tenantId: context.tenantId }, select: { id: true, status: true } });
      if (!company) throw new NotFoundException("Company was not found.");
      if (company.status === request.status) return { updated: true, status: company.status };
      await tx.company.update({ where: { id: company.id }, data: { status: request.status } });
      await this.audit(tx, context, "administration.company.status_changed", "Company", company.id, { status: company.status }, { status: request.status, reason: request.reason });
      return { updated: true, status: request.status };
    });
  }
  async updateCompanyMigrationReviewLock(context: TrustedTenantAdministratorContext, companyId: string, request: UpdateAdministrationCompanyMigrationReviewLockRequest) {
    this.ownerOnly(context);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const company = await tx.company.findFirst({ where: { id: companyId, tenantId: context.tenantId }, select: { id: true, migrationReviewLocked: true } });
      if (!company) throw new NotFoundException("Company was not found.");
      if (company.migrationReviewLocked === request.locked) return { updated: true, locked: company.migrationReviewLocked };
      await tx.company.update({ where: { id: company.id }, data: { migrationReviewLocked: request.locked } });
      await this.audit(tx, context, "administration.company.migration_review_lock_changed", "Company", company.id, { migrationReviewLocked: company.migrationReviewLocked }, { migrationReviewLocked: request.locked, reason: request.reason });
      return { updated: true, locked: request.locked };
    });
  }
  private companyLogoStoragePath(storageReference: string): string {
    if (!/^company-branding\/[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f-]+\.(png|jpg|webp)$/.test(storageReference)) throw new ForbiddenException("Company logo storage reference is not permitted.");
    const root = resolve(process.env.BASEER_COMPANY_LOGO_STORAGE_ROOT ?? join(process.cwd(), "storage"));
    const target = resolve(root, storageReference);
    if (!target.startsWith(`${root}${sep}`)) throw new ForbiddenException("Company logo storage path is not permitted.");
    return target;
  }

  private companyLogoImageType(content: Buffer): { mime: string; extension: string } | null {
    if (content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", extension: "png" };
    if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return { mime: "image/jpeg", extension: "jpg" };
    if (content.length >= 12 && content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP") return { mime: "image/webp", extension: "webp" };
    return null;
  }
  private async assertAnotherActiveOwner(tx: Prisma.TransactionClient, tenantId: string, userId: string): Promise<void> {
    const owners = await tx.tenantAdministrationAssignment.findMany({ where: { tenantId, isOwner: true }, include: { user: { select: { id: true, status: true } } } });
    const targetIsOwner = owners.some((owner) => owner.userId === userId);
    if (targetIsOwner && !owners.some((owner) => owner.userId !== userId && owner.user.status === UserStatus.ACTIVE)) {
      throw new ConflictException("The last active tenant owner cannot be disabled.");
    }
  }

  private async revokeUserSessions(tx: Prisma.TransactionClient, tenantId: string, userId: string): Promise<void> {
    await tx.appSession.updateMany({ where: { tenantId, userId, status: SessionStatus.ACTIVE }, data: { status: SessionStatus.REVOKED, revokedAt: new Date() } });
  }
  private async ensureSystemRoles(tx: Prisma.TransactionClient, tenantId: string): Promise<void> {
    if (await tx.role.count({ where: { tenantId } })) return;
    for (const template of SYSTEM_ROLE_TEMPLATES) {
      const role = await tx.role.create({ data: { id: randomUUID(), tenantId, code: template.code, nameAr: template.nameAr, nameEn: template.nameEn, isSystem: true } });
      await tx.rolePermission.createMany({ data: [...template.permissions].map((permissionCode) => ({ tenantId, roleId: role.id, permissionCode })) });
    }
  }
  private ownerOnly(context: TrustedTenantAdministratorContext): void { if (!context.isOwner) throw new ForbiddenException("Tenant-owner access is required."); }
  private async audit(tx: Prisma.TransactionClient, context: TrustedTenantAdministratorContext, action: string, entityType: string, entityId: string, beforeJson: unknown, afterJson: unknown): Promise<void> { await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, actorUserId: context.actorUserId, action, entityType, entityId, requestId: RequestContext.correlationId() ?? randomUUID(), beforeJson: beforeJson === null ? Prisma.JsonNull : beforeJson as Prisma.InputJsonValue, afterJson: afterJson as Prisma.InputJsonValue } }); }
}
