export type AdministrationMembership = {
  companyId: string;
  companyNameAr: string;
  roleId: string;
  roleNameAr: string;
};

export type AdministrationOverview = {
  owner: boolean;
  companies: Array<{ id: string; nameAr: string; nameEn: string; businessTimezone: string; status: "ACTIVE" | "ARCHIVED"; logoFileMetadataId: string | null }>;
  users: Array<{ id: string; login: string; nameAr: string; nameEn: string; preferredLanguage: "ar" | "en"; avatarKind: "INITIALS" | "MALE" | "FEMALE"; status: "ACTIVE" | "DISABLED"; memberships: AdministrationMembership[] }>;
  roles: Array<{ id: string; code: string; nameAr: string; nameEn: string; isSystem: boolean; permissionCodes: string[] }>;
  permissions: Array<{ code: string; module: string; nameAr: string; risk: "standard" | "sensitive" }>;
};