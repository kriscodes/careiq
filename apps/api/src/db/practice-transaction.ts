import type { PoolClient } from "pg";
import { pool } from "./client.js";

export async function practiceTransaction<T>(practiceId: string | null, actorUserId: string, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.practice_id',$1,true),set_config('app.actor_user_id',$2,true),set_config('app.location_id','',true)", [practiceId ?? "", actorUserId]);
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
