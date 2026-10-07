import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";

export const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
export class ReleaseCheckError extends Error {}
export type MigrationEntry = { tag: string; when: number; hash: string };

export async function migrationManifest(folder = migrationsFolder): Promise<MigrationEntry[]> {
  const journal = JSON.parse(await readFile(`${folder}/meta/_journal.json`, "utf8")) as { entries?: { idx: number; when: number; tag: string }[] };
  if (!Array.isArray(journal.entries) || !journal.entries.length) throw new ReleaseCheckError("Migration journal is missing or empty.");
  const entries: MigrationEntry[] = [];
  for (const [index, entry] of journal.entries.entries()) {
    if (entry.idx !== index || !Number.isSafeInteger(entry.when) || entry.when <= (entries.at(-1)?.when ?? 0) || !new RegExp(`^${String(index).padStart(4, "0")}_[a-zA-Z0-9_-]+$`).test(entry.tag)) throw new ReleaseCheckError("Migration journal order or identity is invalid.");
    const sql = await readFile(`${folder}/${entry.tag}.sql`, "utf8");
    entries.push({ tag: entry.tag, when: entry.when, hash: createHash("sha256").update(sql).digest("hex") });
  }
  const files = (await readdir(folder)).filter((name) => name.endsWith(".sql"));
  if (files.length !== entries.length || files.some((name) => !entries.some((entry) => `${entry.tag}.sql` === name))) throw new ReleaseCheckError("Every SQL migration must have exactly one journal entry.");
  return entries;
}

export function assertMigrationLedger(entries: MigrationEntry[], ledger: { hash: string; created_at: string | number }[], complete = false) {
  if (ledger.length > entries.length || (complete && ledger.length !== entries.length)) throw new ReleaseCheckError("Database migration history differs from this release.");
  for (const [index, row] of ledger.entries()) {
    if (Number(row.created_at) !== entries[index]!.when || row.hash !== entries[index]!.hash) throw new ReleaseCheckError("Applied migration order or checksum differs from this release. Stop and reconcile migration history; do not edit applied SQL.");
  }
}

export async function readMigrationLedger(client: Pick<PoolClient, "query">) {
  const relation = await client.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS ledger, to_regclass('public.practices') AS practices");
  if (!relation.rows[0].ledger) {
    if (relation.rows[0].practices) throw new ReleaseCheckError("Existing application tables have no migration ledger; explicit history reconciliation is required.");
    return [];
  }
  return (await client.query("SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at,id")).rows as { hash: string; created_at: string }[];
}

export function assertMigrationTarget(databaseUrl: string, actualDatabase: string, confirmation?: string) {
  const target = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(target.protocol) || decodeURIComponent(target.pathname.slice(1)) !== actualDatabase) throw new ReleaseCheckError("Migration connection does not identify the expected PostgreSQL database.");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  if (!local && confirmation !== actualDatabase) throw new ReleaseCheckError("Non-loopback migration requires --confirm-database with the exact reviewed database name. Complete backup/restore rehearsal first.");
}
