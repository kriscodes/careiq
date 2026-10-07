import { sql } from "drizzle-orm";

import type { TenantContext } from "../middleware/tenant-context.js";
import { db } from "./client.js";

export async function withTenant<T>(
    context: string | TenantContext,
    callback: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
    return db.transaction(async (tx) => {
        const tenant = typeof context === "string" ? { practiceId: context, userId: "", locationId: undefined, membershipId: undefined } : context;
        await tx.execute(sql`select set_config('app.practice_id', ${tenant.practiceId}, true), set_config('app.actor_user_id', ${tenant.userId}, true), set_config('app.location_id', ${tenant.locationId ?? ""}, true)`);
        // Serialize activation with every clinical transaction, including legacy writes, so a
        // previously uncommitted unmapped row cannot slip past the operator's mapping check.
        const practice = await tx.execute(sql`select id,authorization_mode from practices where id=${tenant.practiceId} and status='active' for share`);
        if (!practice.rowCount) throw new Error("LOCATION_ACCESS_DENIED");
        if (!tenant.locationId && practice.rows[0].authorization_mode === "location") throw new Error("LOCATION_CONTEXT_REQUIRED");
        if (tenant.locationId) {
            // Share locks serialize local revocation/closure with authorized transactions. A revocation
            // waits for already-authorized work; operations starting after commit cannot retain access.
            if (practice.rows[0].authorization_mode !== "location") throw new Error("LOCATION_ACCESS_DENIED");
            const member = await tx.execute(sql`select user_id from practice_member_access where practice_id=${tenant.practiceId} and user_id=${tenant.userId} and membership_id=${tenant.membershipId ?? ""} and status='active' for share`);
            const location = await tx.execute(sql`select id from locations where practice_id=${tenant.practiceId} and id=${tenant.locationId} and status='active' for share`);
            const assignment = await tx.execute(sql`select location_id from location_assignments where practice_id=${tenant.practiceId} and user_id=${tenant.userId} and location_id=${tenant.locationId} and active for share`);
            if (!practice.rowCount || !member.rowCount || !location.rowCount || !assignment.rowCount) throw new Error("LOCATION_ACCESS_DENIED");
        }

        return callback(tx);
    })

}