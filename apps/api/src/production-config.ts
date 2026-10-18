import { isIP } from "node:net";
import { privateStorageRoot } from "./workflow/storage-config.js";
import { connectionOptions } from "./db/connection.js";
import { runtimePoolPolicy } from "./db/runtime-pool-policy.js";
import { interviewRequestsEnabled, parseClerkAuthenticationPolicy, parseTrustedProxies } from "./public-config.js";

/** Decode only the configured public key; never derive trust from unverified JWT claims. */
export function clerkIssuer(publishableKey: string | undefined): string {
  const match = /^pk_(?:test|live)_([A-Za-z0-9_+/=-]+)$/.exec(publishableKey ?? "");
  if (!match) throw new Error("A valid CLERK_PUBLISHABLE_KEY is required.");
  const decoded = Buffer.from(match[1]!, "base64").toString("utf8");
  if (!decoded.endsWith("$")) throw new Error("CLERK_PUBLISHABLE_KEY must encode its Clerk frontend hostname.");
  const host = decoded.slice(0, -1);
  if (!/^[a-z0-9.-]+$/i.test(host) || !host.includes(".") || host.includes("..")) throw new Error("CLERK_PUBLISHABLE_KEY must encode its Clerk frontend hostname.");
  const url = new URL(`https://${host}`);
  if (url.hostname !== host.toLowerCase()) throw new Error("CLERK_PUBLISHABLE_KEY has an invalid frontend hostname.");
  return url.origin;
}

function hostedHttps(origin: string): boolean {
  const url = new URL(origin);
  return url.protocol === "https:" && !isIP(url.hostname.replace(/^\[|\]$/g, "")) && url.hostname.includes(".") && !/(^|\.)(localhost|local|internal)$/.test(url.hostname);
}

export class ProductionConfigurationError extends Error {}

function checkProductionConfiguration(environment: NodeJS.ProcessEnv) {
  if (environment.NODE_ENV !== "production") return;
  if (!environment.CLERK_PUBLISHABLE_KEY?.startsWith("pk_live_") || !/^sk_live_[A-Za-z0-9_-]+$/.test(environment.CLERK_SECRET_KEY ?? "")) {
    throw new Error("Production requires Clerk live publishable and secret keys from the same configured instance.");
  }
  const issuer = clerkIssuer(environment.CLERK_PUBLISHABLE_KEY);
  if (!hostedHttps(issuer)) throw new Error("Production Clerk configuration requires a hosted HTTPS frontend.");
  const policy = parseClerkAuthenticationPolicy(environment);
  if (![...policy.browserOrigins, ...policy.nativeAuthorizedParties].every(hostedHttps)) throw new Error("Production authorized origins must be hosted HTTPS origins.");
  parseTrustedProxies(environment.TRUSTED_PROXY_CIDRS);
  interviewRequestsEnabled(environment.INTERVIEW_REQUESTS_ENABLED);
  runtimePoolPolicy(environment);
  privateStorageRoot(environment);
  if (!/^[a-f0-9]{64,}$/i.test(environment.CAREIQ_WORKFLOW_CURSOR_SECRET ?? "")) throw new Error("Production requires CAREIQ_WORKFLOW_CURSOR_SECRET with at least 32 random bytes encoded as hexadecimal.");
  if (environment.CAREIQ_AUDIT_DATABASE_URL) {
    privateStorageRoot({...environment, CAREIQ_PRIVATE_STORAGE_DIR:environment.CAREIQ_AUDIT_EXPORT_DIR});
    if (connectionOptions({...environment, DATABASE_URL:environment.CAREIQ_AUDIT_DATABASE_URL, DATABASE_SSL_MODE:environment.CAREIQ_AUDIT_SSL_MODE || "verify-full"}).ssl === false) throw new Error("Production protected audit database TLS cannot be disabled.");
    if (!/^[a-f0-9]{64,}$/i.test(environment.CAREIQ_AUDIT_CURSOR_SECRET ?? "") || environment.CAREIQ_AUDIT_CURSOR_SECRET === environment.CAREIQ_WORKFLOW_CURSOR_SECRET) throw new Error("Production protected audit requires a separate random hexadecimal CAREIQ_AUDIT_CURSOR_SECRET of at least 32 bytes.");
  }
  const options = connectionOptions(environment);
  const database = new URL(options.connectionString!);
  if (!["postgres:", "postgresql:"].includes(database.protocol) || !database.username || !database.hostname || database.pathname.length < 2) throw new Error("DATABASE_URL must identify a PostgreSQL login and database.");
  if (options.ssl === false) throw new Error("Production database TLS cannot be disabled; use verify-full or the reviewed provider-internal require mode.");
  if (!/^whsec_[A-Za-z0-9+/=_-]+$/.test(environment.CLERK_WEBHOOK_SIGNING_SECRET ?? "")) throw new Error("Production requires CLERK_WEBHOOK_SIGNING_SECRET for membership reconciliation.");
  let redirect: URL;
  try { redirect = new URL(environment.CAREIQ_INVITATION_REDIRECT_URL ?? ""); } catch { throw new Error("Production requires a fixed CAREIQ_INVITATION_REDIRECT_URL."); }
  if (!hostedHttps(redirect.origin) || redirect.username || redirect.password || !policy.browserOrigins.includes(redirect.origin)) throw new Error("Invitation redirects must use a configured production browser origin.");
  if ((environment.CAREIQ_PRACTICE_CREATOR_USER_IDS ?? "").split(",").filter((value) => value.trim()).some((value) => !/^user_[A-Za-z0-9]+$/.test(value.trim()))) throw new Error("Founder approval must contain explicit Clerk user IDs.");
  if ((environment.CAREIQ_STAFF_ROLES ?? "").split(",").filter((value) => value.trim()).some((value) => !/^org:[a-z][a-z0-9_]{0,63}$/.test(value.trim()))) throw new Error("Staff roles must contain explicit Clerk organization role keys.");
}

/** Production fails closed; local test configuration remains supported. Values never enter errors. */
export function validateProductionConfiguration(environment: NodeJS.ProcessEnv = process.env) {
  try { checkProductionConfiguration(environment); }
  catch (error) { throw new ProductionConfigurationError(error instanceof Error ? error.message : "Production API configuration is invalid."); }
}
