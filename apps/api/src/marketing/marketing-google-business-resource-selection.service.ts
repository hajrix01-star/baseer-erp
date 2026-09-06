import { BadGatewayException, ConflictException, ForbiddenException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "node:crypto";

import type { SelectMarketingGoogleBusinessPilotLocationRequest } from "@baseer-erp/contracts";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { IdempotencyPayloadMismatchError, IdempotencyService, type CanonicalJsonValue } from "../core-controls/idempotency.service.js";
import { DatabaseService } from "../database/database.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { MarketingGoogleCredentialVault } from "./marketing-google-credential-vault.js";
import { MarketingGooglePlatformService } from "./marketing-google-platform.service.js";

const ACCOUNT_NAME = /^accounts\/[A-Za-z0-9_-]{1,128}$/;
const LOCATION_NAME = /^locations\/[A-Za-z0-9_-]{1,128}$/;
const MAX_RESULTS = 100;
const GOOGLE_TIMEOUT_MS = 12_000;

type ActiveConnection = Readonly<{
  id: string;
  ciphertext: string;
  iv: string;
  tag: string;
  keyVersion: number;
}>;
type Account = Readonly<{ resourceName: string; accountName: string; accountType: string }>;
type Location = Readonly<{ resourceName: string; title: string; address: string | null }>;
const SELECTABLE_CONNECTION_STATUSES: ("AUTHORIZED_AWAITING_SELECTION" | "AUTHORIZED_READ_ONLY_SELECTED")[] = ["AUTHORIZED_AWAITING_SELECTION", "AUTHORIZED_READ_ONLY_SELECTED"];

/**
 * MKT-02B's deliberately narrow read-only boundary. Discovery stays transient:
 * only an explicitly confirmed account/location mapping is persisted.
 */
@Injectable()
export class MarketingGoogleBusinessResourceSelectionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly platform: MarketingGooglePlatformService,
    private readonly vault: MarketingGoogleCredentialVault,
    private readonly idempotency: IdempotencyService,
  ) {}

  async resources(context: TrustedCompanyActorContext) {
    const connection = await this.activeConnection(context);
    const accessToken = await this.accessToken(context, connection);
    const [accounts, selected] = await Promise.all([
      this.accounts(accessToken),
      this.selectedMapping(context),
    ]);
    return {
      accounts,
      selectedReadOnly: Boolean(selected),
      selectedAccountResourceName: selected?.googleAccountResourceName ?? null,
      selectedLocationResourceName: selected?.googleLocationResourceName ?? null,
    };
  }

  async locations(context: TrustedCompanyActorContext, accountResourceName: string) {
    this.accountName(accountResourceName);
    const connection = await this.activeConnection(context);
    const accessToken = await this.accessToken(context, connection);
    // Prove that the requested account is part of this company's OAuth grant
    // before its locations are requested. The route never trusts an account
    // name received from the browser alone.
    const accounts = await this.accounts(accessToken);
    if (!accounts.some((account) => account.resourceName === accountResourceName)) throw new ForbiddenException("Google Business account is not available for this company.");
    return { accountResourceName, locations: await this.locationsFor(accessToken, accountResourceName) };
  }

  async select(context: TrustedCompanyActorContext, request: SelectMarketingGoogleBusinessPilotLocationRequest) {
    this.accountName(request.accountResourceName);
    this.locationName(request.locationResourceName);
    const connection = await this.activeConnection(context);
    const accessToken = await this.accessToken(context, connection);
    const accounts = await this.accounts(accessToken);
    if (!accounts.some((account) => account.resourceName === request.accountResourceName)) throw new ForbiddenException("Google Business account is not available for this company.");
    const locations = await this.locationsFor(accessToken, request.accountResourceName);
    if (!locations.some((location) => location.resourceName === request.locationResourceName)) throw new ForbiddenException("Google Business location is not available for this account.");

    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      let begun;
      try {
        begun = await this.idempotency.beginInTransaction(tx, context, {
          operation: "marketing.google_business_pilot.location.select", key: request.idempotencyKey,
          request: { accountResourceName: request.accountResourceName, locationResourceName: request.locationResourceName }, expiresAt: new Date(Date.now() + 86_400_000),
        });
      } catch (error) {
        if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException("The idempotency key was already used with a different location selection.");
        throw error;
      }
      if (begun.kind === "replay") return { ...(begun.response.body as { id: string; selectedReadOnly: true; selectedAt: string }), replayed: true };
      if (begun.kind === "in-progress") throw new ConflictException("The Google Business location selection is still in progress.");
      await this.lockCompany(tx, context.tenantId, context.companyId);
      const current = await tx.marketingProviderConnection.findFirst({
        where: { id: connection.id, tenantId: context.tenantId, companyId: context.companyId, provider: "GOOGLE_BUSINESS", status: { in: SELECTABLE_CONNECTION_STATUSES } },
        select: { id: true },
      });
      if (!current) throw new ConflictException("Google Business connection is not ready for location selection.");
      const existing = await tx.marketingGoogleBusinessLocationMapping.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId, connectionId: connection.id, provider: "GOOGLE_BUSINESS" },
        select: { id: true },
      });
      const selectedAt = new Date();
      const mapping = existing
        ? await tx.marketingGoogleBusinessLocationMapping.update({
          where: { id: existing.id },
          data: { googleAccountResourceName: request.accountResourceName, googleLocationResourceName: request.locationResourceName, selectedAt, selectedByUserId: context.actorUserId },
        })
        : await tx.marketingGoogleBusinessLocationMapping.create({
          data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, connectionId: connection.id, provider: "GOOGLE_BUSINESS", googleAccountResourceName: request.accountResourceName, googleLocationResourceName: request.locationResourceName, selectedAt, selectedByUserId: context.actorUserId },
        });
      await tx.marketingProviderConnection.update({ where: { id: current.id }, data: { status: "AUTHORIZED_READ_ONLY_SELECTED" } });
      await tx.auditEvent.create({
        data: {
          id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId,
          action: "marketing.google_business_pilot.location_selected", entityType: "MarketingGoogleBusinessLocationMapping", entityId: mapping.id,
          requestId: randomUUID(), beforeJson: Prisma.JsonNull, afterJson: { selectedReadOnly: true } as Prisma.InputJsonValue,
        },
      });
      const receipt = { id: mapping.id, replayed: false, selectedReadOnly: true as const, selectedAt: mapping.selectedAt.toISOString() };
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: receipt as CanonicalJsonValue } });
      return receipt;
    });
  }

  /**
   * The one-step OAuth completion path. It writes only when Google exposes a
   * single unambiguous account/location pair; any plurality stays pending so
   * a branch can never be chosen by name, order, or guesswork.
   */
  async selectOnlyAvailableResource(context: TrustedCompanyActorContext) {
    const connection = await this.activeConnection(context);
    const accessToken = await this.accessToken(context, connection);
    const accounts = await this.accounts(accessToken);
    const [account] = accounts;
    if (!account || accounts.length !== 1) return { selected: false as const, reason: "ACCOUNT_AMBIGUOUS" as const };
    const locations = await this.locationsFor(accessToken, account.resourceName);
    const [location] = locations;
    if (!location || locations.length !== 1) return { selected: false as const, reason: "LOCATION_AMBIGUOUS" as const };

    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.lockCompany(tx, context.tenantId, context.companyId);
      const current = await tx.marketingProviderConnection.findFirst({
        where: { id: connection.id, tenantId: context.tenantId, companyId: context.companyId, provider: "GOOGLE_BUSINESS", status: "AUTHORIZED_AWAITING_SELECTION" },
        select: { id: true },
      });
      if (!current) return { selected: false as const, reason: "CONNECTION_CHANGED" as const };
      const selectedAt = new Date();
      const existing = await tx.marketingGoogleBusinessLocationMapping.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId, connectionId: connection.id, provider: "GOOGLE_BUSINESS" },
        select: { id: true },
      });
      const mapping = existing
        ? await tx.marketingGoogleBusinessLocationMapping.update({ where: { id: existing.id }, data: { googleAccountResourceName: account.resourceName, googleLocationResourceName: location.resourceName, selectedAt, selectedByUserId: context.actorUserId } })
        : await tx.marketingGoogleBusinessLocationMapping.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, connectionId: connection.id, provider: "GOOGLE_BUSINESS", googleAccountResourceName: account.resourceName, googleLocationResourceName: location.resourceName, selectedAt, selectedByUserId: context.actorUserId } });
      await tx.marketingProviderConnection.update({ where: { id: current.id }, data: { status: "AUTHORIZED_READ_ONLY_SELECTED" } });
      await tx.auditEvent.create({
        data: {
          id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId,
          action: "marketing.google_business_pilot.only_resource_selected", entityType: "MarketingGoogleBusinessLocationMapping", entityId: mapping.id,
          requestId: randomUUID(), beforeJson: Prisma.JsonNull, afterJson: { selectedReadOnly: true, selectionMode: "ONLY_AVAILABLE_RESOURCE" } as Prisma.InputJsonValue,
        },
      });
      return { selected: true as const, reason: null };
    });
  }

  private async activeConnection(context: TrustedCompanyActorContext): Promise<ActiveConnection> {
    this.requirePilotCompany(context.companyId);
    // Rechecks every enabled/configured value before secret decryption or egress.
    this.platform.googleBusinessPilotConfiguration();
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const connection = await tx.marketingProviderConnection.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId, provider: "GOOGLE_BUSINESS", status: { in: SELECTABLE_CONNECTION_STATUSES } },
        select: { id: true, credentialEnvelope: { select: { ciphertext: true, iv: true, tag: true, keyVersion: true, status: true, revokedAt: true } } },
      });
      const envelope = connection?.credentialEnvelope;
      if (!connection || !envelope || envelope.status !== "ACTIVE" || envelope.revokedAt) throw new ConflictException("Google Business authorization is not ready for location selection.");
      return { id: connection.id, ciphertext: envelope.ciphertext, iv: envelope.iv, tag: envelope.tag, keyVersion: envelope.keyVersion };
    });
  }

  private async selectedMapping(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, (tx) => tx.marketingGoogleBusinessLocationMapping.findFirst({
      where: { tenantId: context.tenantId, companyId: context.companyId, provider: "GOOGLE_BUSINESS" },
      orderBy: { selectedAt: "desc" },
      select: { googleAccountResourceName: true, googleLocationResourceName: true },
    }));
  }

  private async accessToken(context: TrustedCompanyActorContext, connection: ActiveConnection): Promise<string> {
    const raw = this.vault.decrypt(connection, { tenantId: context.tenantId, companyId: context.companyId, provider: "GOOGLE_BUSINESS" });
    let refreshToken = "";
    try {
      const parsed = JSON.parse(raw) as { kind?: unknown; refreshToken?: unknown };
      if (parsed.kind === "google-business-refresh-token.v1" && typeof parsed.refreshToken === "string") refreshToken = parsed.refreshToken.trim();
    } catch { /* handled by the safe boundary below */ }
    if (!refreshToken) throw new ServiceUnavailableException("Google Business authorization must be renewed.");
    const config = this.platform.googleBusinessPilotConfiguration();
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
      headers: { "content-type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    }).catch(() => null);
    const body = await response?.json().catch(() => ({})) as { access_token?: unknown };
    if (!response?.ok || typeof body.access_token !== "string" || !body.access_token.trim()) throw new BadGatewayException("Google Business resources could not be read.");
    return body.access_token.trim();
  }

  private async accounts(accessToken: string): Promise<Account[]> {
    const response = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=100", {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS), headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    }).catch(() => null);
    const body = await response?.json().catch(() => ({})) as { accounts?: unknown };
    if (!response?.ok || !Array.isArray(body.accounts)) throw new BadGatewayException("Google Business accounts could not be read.");
    return body.accounts.slice(0, MAX_RESULTS).flatMap((item): Account[] => {
      if (!isRecord(item) || typeof item.name !== "string" || !ACCOUNT_NAME.test(item.name) || typeof item.accountName !== "string" || !item.accountName.trim()) return [];
      return [{ resourceName: item.name, accountName: item.accountName.trim().slice(0, 200), accountType: typeof item.type === "string" && item.type.trim() ? item.type.trim().slice(0, 80) : "UNSPECIFIED" }];
    });
  }

  private async locationsFor(accessToken: string, accountResourceName: string): Promise<Location[]> {
    const url = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${accountResourceName}/locations`);
    url.search = new URLSearchParams({ pageSize: String(MAX_RESULTS), readMask: "name,title,storefrontAddress" }).toString();
    const response = await fetch(url, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS), headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    }).catch(() => null);
    const body = await response?.json().catch(() => ({})) as { locations?: unknown };
    if (!response?.ok || !Array.isArray(body.locations)) throw new BadGatewayException("Google Business locations could not be read.");
    return body.locations.slice(0, MAX_RESULTS).flatMap((item): Location[] => {
      if (!isRecord(item) || typeof item.name !== "string" || !LOCATION_NAME.test(item.name) || typeof item.title !== "string" || !item.title.trim()) return [];
      return [{ resourceName: item.name, title: item.title.trim().slice(0, 240), address: address(item.storefrontAddress) }];
    });
  }

  private requirePilotCompany(companyId: string) {
    if (this.platform.googleBusinessPilotCompanyId() !== companyId) throw new ForbiddenException("Google Business pilot is not available for this company.");
  }
  private accountName(value: string) { if (!ACCOUNT_NAME.test(value)) throw new ForbiddenException("Google Business account is invalid."); }
  private locationName(value: string) { if (!LOCATION_NAME.test(value)) throw new ForbiddenException("Google Business location is invalid."); }
  private async lockCompany(tx: Prisma.TransactionClient, tenantId: string, companyId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`marketing-google-business-selection:${tenantId}:${companyId}`}, 0))`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function address(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const lines = Array.isArray(value.addressLines) ? value.addressLines.filter((line): line is string => typeof line === "string" && Boolean(line.trim())).map((line) => line.trim()) : [];
  const rest = [value.locality, value.administrativeArea, value.postalCode, value.regionCode].filter((part): part is string => typeof part === "string" && Boolean(part.trim())).map((part) => part.trim());
  const result = [...lines, ...rest].join(", ").trim();
  return result ? result.slice(0, 360) : null;
}
