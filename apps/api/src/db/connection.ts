import "dotenv/config";
import type { PoolConfig } from "pg";

const sslUrlParameters = new Set([
  "ssl",
  "sslmode",
  "sslcert",
  "sslkey",
  "sslrootcert",
  "sslnegotiation",
  "uselibpqcompat",
]);

export function connectionOptions(environment: NodeJS.ProcessEnv = process.env): PoolConfig {
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  const mode = environment.DATABASE_SSL_MODE ?? "verify-full";
  if (!["disable", "require", "verify-full"].includes(mode)) {
    throw new Error("DATABASE_SSL_MODE must be disable, require, or verify-full.");
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }

  // pg lets URL parameters override an explicit ssl option. Keep one source of
  // truth so a provider URL cannot silently disable the configured protection.
  if ([...url.searchParams.keys()].some((key) => sslUrlParameters.has(key.toLowerCase()))) {
    throw new Error("Remove SSL parameters from DATABASE_URL and configure TLS with DATABASE_SSL_MODE (disable, require, or verify-full).");
  }

  return {
    connectionString,
    connectionTimeoutMillis: 10000,
    ssl: mode === "disable" ? false : { rejectUnauthorized: mode === "verify-full" },
  };
}
