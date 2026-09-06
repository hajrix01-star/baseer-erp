export type AdministrationMembership = {
  companyId: string;
  companyNameAr: string;
  companyNameEn: string;
  roleId: string;
  roleNameAr: string;
  roleNameEn: string;
};

export type AdministrationOverview = {
  owner: boolean;
  companies: Array<{ id: string; nameAr: string; nameEn: string; businessTimezone: string; status: "ACTIVE" | "ARCHIVED"; migrationReviewLocked: boolean; logoFileMetadataId: string | null; contextLocationCode: string | null; contextLocationLabelAr: string | null; contextLatitude: number | null; contextLongitude: number | null }>;
  users: Array<{ id: string; login: string; nameAr: string; nameEn: string; preferredLanguage: "ar" | "en"; avatarKind: "INITIALS" | "MALE" | "FEMALE"; status: "ACTIVE" | "DISABLED"; isOwner: boolean; memberships: AdministrationMembership[] }>;
  roles: Array<{ id: string; code: string; nameAr: string; nameEn: string; isSystem: boolean; permissionCodes: string[] }>;
  permissions: Array<{ code: string; module: string; moduleAr: string; moduleEn: string; moduleOrder: number; sectionAr: string; sectionEn: string; sectionOrder: number; nameAr: string; nameEn: string; risk: "standard" | "sensitive"; requires: string[] }>;
};
