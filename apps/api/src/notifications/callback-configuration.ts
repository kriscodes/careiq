import type { DeliveryCallbackOptions } from '../routes/patient-delivery.js';
import { notificationWorkerConfiguration } from './worker.js';

/** Signature verification occurs in the provider route before any reference is used here. */
export function configuredDeliveryCallbacks(environment: NodeJS.ProcessEnv = process.env): DeliveryCallbackOptions | undefined {
    const route = environment.CAREIQ_DELIVERY_CALLBACK_ROUTE_KEY;
    if (!route) {
        if (environment.CAREIQ_DELIVERY_ENABLED === 'true') throw new Error('DELIVERY_CALLBACK_CONFIGURATION_REQUIRED');
        return undefined;
    }
    if (!/^[A-Za-z0-9_-]{24,100}$/.test(route)) throw new Error('INVALID_DELIVERY_CALLBACK_ROUTE');
    const configured = notificationWorkerConfiguration({ ...environment, CAREIQ_NOTIFICATION_WORKER_ENABLED: 'true' }).scopes;
    for (const [key, suffix] of [['CAREIQ_TWILIO_CALLBACK_URL', 'twilio'], ['CAREIQ_TWILIO_INBOUND_URL', 'twilio-inbound']] as const) {
        if (!environment[key]) continue;
        const url = new URL(environment[key]!);
        if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || url.pathname !== `/api/v1/delivery-callbacks/${route}/${suffix}`) throw new Error('INVALID_DELIVERY_CALLBACK_URL');
    }
    return { env: environment, resolveTenant: async (routeKey, provider, reference) => {
        if (routeKey !== route) return null;
        const [{ practiceAccess }, { scoped }, { AccessError }] = await Promise.all([import('../services/practice-access.service.js'), import('../workflow/transaction.js'), import('../services/practice-policy.js')]);
        for (const enrollment of configured) {
            let authorized;
            try { authorized = await practiceAccess.authorizeLocation({ isAuthenticated: true, userId: enrollment.userId, orgId: enrollment.orgId }, enrollment.locationId); }
            catch (error) {
                // A removed enrollment cannot prevent callbacks for later valid scopes.
                if (error instanceof AccessError && error.status < 500) continue;
                throw error;
            }
            const { tenant, permissions } = authorized;
            if (tenant.practiceId !== enrollment.practiceId || tenant.membershipId !== enrollment.membershipId || !permissions?.includes('org:requests:send') || !permissions.includes('org:documents:read')) continue;
            // Inbound opt-out is account/destination scoped, never bound to a patient from the webhook body.
            if (reference?.inbound || !reference?.providerMessageId && !reference?.intentId) return tenant;
            const account = provider === 'resend' ? environment.CAREIQ_RESEND_ACCOUNT : environment.CAREIQ_TWILIO_ACCOUNT_SID;
            const matched = await scoped(tenant, async client => (await client.query('SELECT id FROM delivery_intents WHERE practice_id=$1 AND location_id=$2 AND provider_id=$3 AND provider_account=$4 AND (($5::uuid IS NOT NULL AND id=$5) OR ($6::text IS NOT NULL AND provider_message_id=$6)) LIMIT 1', [tenant.practiceId, tenant.locationId, provider, account, reference?.intentId ?? null, reference?.providerMessageId ?? null])).rowCount === 1);
            if (matched) return tenant;
        }
        return null;
    } };
}
