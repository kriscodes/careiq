import { test } from "node:test";
import assert from "node:assert/strict";
import { clerkIssuer, validateProductionConfiguration } from "../src/production-config.js";
const production = {
  NODE_ENV: "production", CLERK_PUBLISHABLE_KEY: `pk_live_${Buffer.from("clerk.careiq.example$").toString("base64")}`, CLERK_SECRET_KEY: "sk_live_synthetic",
  CLERK_WEBHOOK_SIGNING_SECRET: "whsec_synthetic", CORS_ORIGINS: "https://app.careiq.example,https://careiq.example", DATABASE_URL: "postgresql://runtime:synthetic-secret@db.example/careiq",
  CAREIQ_PRIVATE_STORAGE_DIR: "/var/careiq-private", CAREIQ_WORKFLOW_CURSOR_SECRET: "a".repeat(64),
  DATABASE_SSL_MODE: "verify-full", CAREIQ_INVITATION_REDIRECT_URL: "https://app.careiq.example/?invitations=1",
};
test("production configuration accepts explicit hosted live settings and leaves local review supported", () => {
  validateProductionConfiguration(production);
  validateProductionConfiguration({});
  validateProductionConfiguration({ ...production, DATABASE_SSL_MODE: "require" });
  validateProductionConfiguration({ ...production, CLERK_NATIVE_AUTH_ENABLED: "true", CLERK_NATIVE_AUTHORIZED_PARTIES: "https://native.careiq.example", CAREIQ_PRACTICE_CREATOR_USER_IDS: "user_synthetic", CAREIQ_STAFF_ROLES: "org:clinician" });
  assert.equal(clerkIssuer(production.CLERK_PUBLISHABLE_KEY), "https://clerk.careiq.example");
});
test("production settings fail closed without printing configuration values", () => {
  for (const patch of [
    { CLERK_PUBLISHABLE_KEY: "pk_test_synthetic-secret" }, { CLERK_SECRET_KEY: "sk_test_synthetic-secret" }, { CLERK_PUBLISHABLE_KEY: "pk_live_broken" },
    { CLERK_WEBHOOK_SIGNING_SECRET: "" }, { DATABASE_SSL_MODE: "disable" }, { DATABASE_URL: "https://runtime:synthetic-secret@db.example/careiq" },
    { CORS_ORIGINS: "http://app.careiq.example" }, { CORS_ORIGINS: "https://localhost:3101" }, { CORS_ORIGINS: "https://127.0.0.1" },
    { CAREIQ_INVITATION_REDIRECT_URL: "" }, { CAREIQ_INVITATION_REDIRECT_URL: "https://other.example" }, { CAREIQ_INVITATION_REDIRECT_URL: "https://user:synthetic-secret@app.careiq.example/" },
    { CAREIQ_PRACTICE_CREATOR_USER_IDS: "*" }, { CAREIQ_PRACTICE_CREATOR_USER_IDS: "owner@example.com" }, { CAREIQ_STAFF_ROLES: "administrator" },
    { TRUSTED_PROXY_CIDRS: "true" }, { INTERVIEW_REQUESTS_ENABLED: "yes" }, { CLERK_NATIVE_AUTH_ENABLED: "yes" },
  ]) assert.throws(() => validateProductionConfiguration({ ...production, ...patch }), (error: unknown) => error instanceof Error && !error.message.includes("synthetic-secret"));
  for (const value of [undefined, "pk_live_", `pk_live_${Buffer.from("clerk.example/path$").toString("base64")}`, `pk_live_${Buffer.from("clerk.example$").toString("base64")}:secret`]) assert.throws(() => clerkIssuer(value));
});

test("production rejects development storage and missing or weak cursor keys", () => {
  for (const patch of [
    {CAREIQ_PRIVATE_STORAGE_DIR: undefined}, {CAREIQ_PRIVATE_STORAGE_DIR: "relative/documents"}, {CAREIQ_PRIVATE_STORAGE_DIR: "/"},
    {CAREIQ_PRIVATE_STORAGE_DIR: new URL("../../../web/public", import.meta.url).pathname},
    {CAREIQ_WORKFLOW_CURSOR_SECRET: undefined}, {CAREIQ_WORKFLOW_CURSOR_SECRET: "short"}, {CAREIQ_WORKFLOW_CURSOR_SECRET: "z".repeat(64)},
  ]) assert.throws(() => validateProductionConfiguration({...production, ...patch}));
});

test("optional production audit requires separate cursor custody and private export storage", () => {
  const configured = {...production, CAREIQ_AUDIT_DATABASE_URL:"postgresql://audit:synthetic@db.example/careiq", CAREIQ_AUDIT_EXPORT_DIR:"/var/careiq-audit-private", CAREIQ_AUDIT_CURSOR_SECRET:"b".repeat(64)};
  validateProductionConfiguration(configured);
  for (const patch of [{CAREIQ_AUDIT_SSL_MODE:"disable"}, {CAREIQ_AUDIT_SSL_MODE:"invalid"}, {CAREIQ_AUDIT_EXPORT_DIR:undefined}, {CAREIQ_AUDIT_EXPORT_DIR:".local-review/audit"}, {CAREIQ_AUDIT_CURSOR_SECRET:undefined}, {CAREIQ_AUDIT_CURSOR_SECRET:production.CAREIQ_WORKFLOW_CURSOR_SECRET}]) assert.throws(() => validateProductionConfiguration({...configured,...patch}));
});
