import type { TenantContext, RequestAuthentication } from '../middleware/tenant-context.js';
import { logFailure } from '../logging.js';

type Environment = Record<string, string | undefined>;
type Scope = TenantContext & { locationId: string; membershipId: string };
export type NotificationWorkerDependencies = {
    authorize: (auth: RequestAuthentication, locationId: string) => Promise<{ tenant: TenantContext; permissions?: string[] }>;
    patient: (tenant: TenantContext) => Promise<unknown>;
    staff: (tenant: TenantContext) => Promise<unknown>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bounded = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[\u0000-\u0020]/.test(v);

/** Explicit operator scopes only. This runner never discovers tenants using an unscoped clinical query. */
export function notificationWorkerConfiguration(environment: Environment = process.env): { enabled: boolean; intervalMs: number; scopes: Scope[] } {
    const enabled = environment.CAREIQ_NOTIFICATION_WORKER_ENABLED === 'true';
    if (!enabled) return { enabled: false, intervalMs: 30000, scopes: [] };
    let scopes: unknown;
    try { scopes = JSON.parse(environment.CAREIQ_NOTIFICATION_WORKER_SCOPES ?? ''); } catch { throw new Error('INVALID_NOTIFICATION_WORKER_SCOPES'); }
    if (!Array.isArray(scopes) || !scopes.length || scopes.length > 50) throw new Error('INVALID_NOTIFICATION_WORKER_SCOPES');
    const unique = new Set<string>();
    for (const value of scopes) {
        if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'locationId,membershipId,orgId,practiceId,userId' || !uuid.test(value.practiceId) || !uuid.test(value.locationId) || !bounded(value.userId) || !bounded(value.orgId) || !bounded(value.membershipId)) throw new Error('INVALID_NOTIFICATION_WORKER_SCOPES');
        const key = `${value.practiceId}:${value.locationId}`;
        if (unique.has(key)) throw new Error('DUPLICATE_NOTIFICATION_WORKER_SCOPE');
        unique.add(key);
    }
    const intervalMs = Number(environment.CAREIQ_NOTIFICATION_WORKER_INTERVAL_MS ?? '30000');
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 5000 || intervalMs > 300000) throw new Error('INVALID_NOTIFICATION_WORKER_INTERVAL');
    return { enabled, intervalMs, scopes: scopes as Scope[] };
}

export async function runNotificationWorkerTick(scopes: Scope[], dependencies: NotificationWorkerDependencies): Promise<void> {
    let failures = 0;
    for (const configured of scopes) {
        try {
        // The operator tuple selects a worker principal, but current directory/location authority is still mandatory.
        const current = await dependencies.authorize({ isAuthenticated: true, userId: configured.userId, orgId: configured.orgId }, configured.locationId);
        if (current.tenant.practiceId !== configured.practiceId || current.tenant.orgId !== configured.orgId || current.tenant.userId !== configured.userId || current.tenant.membershipId !== configured.membershipId || current.tenant.locationId !== configured.locationId) throw new Error('NOTIFICATION_WORKER_SCOPE_CHANGED');
        if (!current.permissions?.includes('org:requests:send') || !current.permissions.includes('org:documents:read') || !current.permissions.includes('org:appointments:read')) throw new Error('NOTIFICATION_WORKER_PERMISSION_REQUIRED');
        for (const dispatch of [dependencies.patient, dependencies.staff]) {
            try { await dispatch(current.tenant); } catch { failures++; }
        }
        } catch { failures++; }
    }
    if (failures) throw new Error('NOTIFICATION_WORKER_SCOPE_CHANGED_OR_PERMISSION_REQUIRED_OR_DISPATCH_DEFERRED');
}

export function startNotificationWorker(environment: Environment = process.env): () => void {
    const configuration = notificationWorkerConfiguration(environment);
    if (!configuration.enabled) return () => {};
    let running = false, stopped = false;
    const tick = async () => {
        if (running || stopped) return;
        running = true;
        try {
            const [{ practiceAccess }, patient, staff] = await Promise.all([import('../services/practice-access.service.js'), import('../services/patient-delivery.service.js'), import('../services/staff-notifications.service.js')]);
            await runNotificationWorkerTick(configuration.scopes, { authorize: practiceAccess.authorizeLocation, patient: tenant => patient.runPatientDeliveryBatch(tenant), staff: tenant => staff.runStaffNotificationSweep(tenant) });
        } catch { logFailure('Notification worker deferred; current scope or delivery unavailable', new Error('NOTIFICATION_WORKER_DEFERRED')); }
        finally { running = false; }
    };
    const timer = setInterval(() => { void tick(); }, configuration.intervalMs);
    timer.unref();
    void tick();
    return () => { stopped = true; clearInterval(timer); };
}
