/**
 * Pure, fail-closed schedule planner. It deliberately does not start timers,
 * write BackupJob rows, or enable the archive worker; a future registered
 * dispatcher must atomically consume its dispatch key with BackupPolicy.
 */
export type BackupScheduleFrequency = 'MANUAL' | 'DAILY' | 'WEEKLY' | 'MONTHLY';

export type BackupSchedulePolicy = Readonly<{
  id: string;
  tenantId: string;
  companyId: string;
  enabled: boolean;
  frequency: BackupScheduleFrequency;
  scheduleJson: unknown;
  retentionCount: number;
}>;

export type ParsedBackupSchedule = Readonly<{
  timezone: string;
  hour: number;
  minute: number;
  weekday?: number;
  dayOfMonth?: number;
}>;

export type ScheduledBackupDispatch = Readonly<{
  policyId: string;
  tenantId: string;
  companyId: string;
  periodKey: string;
  idempotencyKey: string;
}>;

export type ScheduleEvaluation = Readonly<{
  eligible: boolean;
  reason: 'MANUAL' | 'DISABLED' | 'INVALID_SCHEDULE' | 'NOT_DUE' | 'DUPLICATE_PERIOD' | 'RUNTIME_DISABLED' | 'DUE';
  dispatch?: ScheduledBackupDispatch;
  errorCode?: string;
}>;

const WEEKDAYS: Readonly<Record<string, number>> = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });

/** A schedule is due only in its exact local minute. Missed minutes are alerts, never silent catch-up jobs. */
export function evaluateBackupPolicySchedule(input: Readonly<{
  policy: BackupSchedulePolicy;
  now: Date;
  runtimeEnabled: boolean;
  existingPeriodKeys: ReadonlySet<string>;
}>): ScheduleEvaluation {
  const { policy } = input;
  if (policy.frequency === 'MANUAL') return { eligible: false, reason: 'MANUAL' };
  if (!policy.enabled) return { eligible: false, reason: 'DISABLED' };
  if (!input.runtimeEnabled) return { eligible: false, reason: 'RUNTIME_DISABLED' };
  const parsed = parseBackupSchedule(policy.frequency, policy.scheduleJson);
  if (!parsed.ok) return { eligible: false, reason: 'INVALID_SCHEDULE', errorCode: parsed.code };
  const local = localScheduleTime(input.now, parsed.value.timezone);
  if (local.hour !== parsed.value.hour || local.minute !== parsed.value.minute) return { eligible: false, reason: 'NOT_DUE' };
  if (policy.frequency === 'WEEKLY' && local.weekday !== parsed.value.weekday) return { eligible: false, reason: 'NOT_DUE' };
  if (policy.frequency === 'MONTHLY' && local.day !== parsed.value.dayOfMonth) return { eligible: false, reason: 'NOT_DUE' };
  const periodKey = scheduledPeriodKey(policy.frequency, local);
  if (input.existingPeriodKeys.has(periodKey)) return { eligible: false, reason: 'DUPLICATE_PERIOD' };
  return {
    eligible: true,
    reason: 'DUE',
    dispatch: {
      policyId: policy.id, tenantId: policy.tenantId, companyId: policy.companyId, periodKey,
      idempotencyKey: `backup-policy:${policy.id}:${periodKey}`,
    },
  };
}

/** Both switches are required. This code never turns on the worker itself. */
export function backupScheduleRuntimeEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.BASEER_BACKUP_SCHEDULER_ENABLED === 'true' && environment.BASEER_BACKUP_WORKER_ENABLED === 'true';
}

export function parseBackupSchedule(frequency: Exclude<BackupScheduleFrequency, 'MANUAL'>, value: unknown): Readonly<{ ok: true; value: ParsedBackupSchedule }> | Readonly<{ ok: false; code: string }> {
  if (!isRecord(value) || !hasOnlyKeys(value, allowedKeys(frequency)) || typeof value.timezone !== 'string' || !isInt(value.hour, 0, 23) || !isInt(value.minute, 0, 59) || !isTimeZone(value.timezone)) {
    return { ok: false, code: 'SCHEDULE_INVALID' };
  }
  if (frequency === 'WEEKLY' && !isInt(value.weekday, 0, 6)) return { ok: false, code: 'SCHEDULE_WEEKDAY_INVALID' };
  if (frequency === 'MONTHLY' && !isInt(value.dayOfMonth, 1, 28)) return { ok: false, code: 'SCHEDULE_DAY_OF_MONTH_INVALID' };
  return {
    ok: true,
    value: {
      timezone: value.timezone, hour: value.hour, minute: value.minute,
      ...(frequency === 'WEEKLY' ? { weekday: value.weekday as number } : {}),
      ...(frequency === 'MONTHLY' ? { dayOfMonth: value.dayOfMonth as number } : {}),
    },
  };
}

export type LocalScheduleTime = Readonly<{ year: number; month: number; day: number; hour: number; minute: number; weekday: number }>;
export function localScheduleTime(now: Date, timezone: string): LocalScheduleTime {
  const values = new Map<string, string>();
  for (const part of new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(now)) {
    if (part.type !== 'literal') values.set(part.type, part.value);
  }
  const weekday = WEEKDAYS[values.get('weekday') ?? ''];
  if (weekday === undefined) throw new TypeError('Schedule timezone did not produce a recognized weekday.');
  return { year: numberPart(values, 'year'), month: numberPart(values, 'month'), day: numberPart(values, 'day'), hour: numberPart(values, 'hour'), minute: numberPart(values, 'minute'), weekday };
}

export function scheduledPeriodKey(frequency: Exclude<BackupScheduleFrequency, 'MANUAL'>, local: LocalScheduleTime): string {
  const day = `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
  if (frequency === 'DAILY') return `daily:${day}`;
  if (frequency === 'WEEKLY') return `weekly:${day}`;
  return `monthly:${local.year}-${String(local.month).padStart(2, '0')}`;
}

/** The current schedule period only after its local due minute and on its configured date. */
export function currentScheduledPeriodKey(policy: BackupSchedulePolicy, now: Date): string | undefined {
  if (policy.frequency === 'MANUAL') return undefined;
  const parsed = parseBackupSchedule(policy.frequency, policy.scheduleJson);
  if (!parsed.ok) return undefined;
  const local = localScheduleTime(now, parsed.value.timezone);
  const dateMatches = policy.frequency === 'DAILY'
    || (policy.frequency === 'WEEKLY' && local.weekday === parsed.value.weekday)
    || (policy.frequency === 'MONTHLY' && local.day === parsed.value.dayOfMonth);
  if (!dateMatches || local.hour < parsed.value.hour || (local.hour === parsed.value.hour && local.minute < parsed.value.minute)) return undefined;
  return scheduledPeriodKey(policy.frequency, local);
}

function allowedKeys(frequency: Exclude<BackupScheduleFrequency, 'MANUAL'>): readonly string[] {
  return frequency === 'DAILY' ? ['timezone', 'hour', 'minute'] : frequency === 'WEEKLY' ? ['timezone', 'hour', 'minute', 'weekday'] : ['timezone', 'hour', 'minute', 'dayOfMonth'];
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(value); return actual.length === keys.length && actual.every((key) => keys.includes(key)); }
function isInt(value: unknown, minimum: number, maximum: number): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum; }
function isTimeZone(value: string): boolean { try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; } }
function numberPart(values: ReadonlyMap<string, string>, key: string): number { const value = Number(values.get(key)); if (!Number.isInteger(value)) throw new TypeError(`Schedule timezone did not produce ${key}.`); return value; }
