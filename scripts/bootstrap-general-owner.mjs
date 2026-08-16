import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({
  path: process.env.BASEER_ENV_FILE ?? "apps/api/.env.baseer-test",
});

const ownerEmail = (
  process.env.BASEER_GENERAL_OWNER_EMAIL ?? "MOHAMMAD.ALHAJRI@HAJRIX.COM"
)
  .trim()
  .toLowerCase();
const tenantCode = (
  process.env.BASEER_OWNER_TENANT_CODE ?? required("BASEER_SYSTEM_TENANT_CODE")
).trim();
const activationCode = required("BASEER_OWNER_ACTIVATION_CODE");
if (activationCode.length < 16)
  throw new Error(
    "BASEER_OWNER_ACTIVATION_CODE must be at least 16 characters.",
  );
const { Pool } = pg;
const pool = new Pool({ connectionString: required("DATABASE_URL") });

try {
  const tenant = await pool.query(
    'SELECT "id" FROM "Tenant" WHERE "code" = $1',
    [tenantCode],
  );
  if (tenant.rowCount !== 1)
    throw new Error(
      "Configured owner tenant was not found. Create the private system tenant first.",
    );
  const tenantId = tenant.rows[0].id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [
      tenantId,
    ]);
    const existing = await client.query(
      'SELECT u."id", a."ownerActivationTokenHash" FROM "User" u LEFT JOIN "TenantAdministrationAssignment" a ON a."tenantId" = u."tenantId" AND a."userId" = u."id" AND a."isOwner" = TRUE WHERE u."tenantId" = $1::uuid AND u."loginNormalized" = $2',
      [tenantId, ownerEmail],
    );
    if (existing.rowCount && existing.rows[0].ownerActivationTokenHash === null)
      throw new Error(
        "The general owner is already active; its password is never overwritten by bootstrap.",
      );
    const userId = existing.rowCount ? existing.rows[0].id : randomUUID();
    if (!existing.rowCount) {
      await client.query(
        'INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "preferredLanguage", "passwordHash", "status") VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)',
        [
          userId,
          tenantId,
          ownerEmail,
          "محمد الحاجري",
          "Mohammad Alhajri",
          "ar",
          await bcrypt.hash(randomUUID(), 12),
          "ACTIVE",
        ],
      );
    }
    const activationHash = await bcrypt.hash(activationCode, 12);
    await client.query(
      'INSERT INTO "TenantAdministrationAssignment" ("tenantId", "userId", "isOwner", "ownerActivationTokenHash", "ownerActivationExpiresAt") VALUES ($1::uuid, $2::uuid, TRUE, $3, NOW() + INTERVAL \'7 days\') ON CONFLICT ("tenantId", "userId") DO UPDATE SET "isOwner" = TRUE, "ownerActivationTokenHash" = EXCLUDED."ownerActivationTokenHash", "ownerActivationExpiresAt" = EXCLUDED."ownerActivationExpiresAt"',
      [tenantId, userId, activationHash],
    );
    await client.query("COMMIT");
    console.log(
      JSON.stringify({
        generalOwner: ownerEmail,
        tenantCode,
        activation: "pending",
        expiresInDays: 7,
      }),
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
