import { sql } from "drizzle-orm";

import { db } from "./client.js";

export async function withTenant<T>(
    practiceId: string,
    callback: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
    return db.transaction(async (tx) => {
        await tx.execute(
            sql`select set_config('app.practice_id', ${practiceId}, true)`,
        );

        return callback(tx);
    })

}