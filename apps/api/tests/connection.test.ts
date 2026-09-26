import { test } from "node:test";
import assert from "node:assert/strict";
import { connectionOptions } from "../src/db/connection.js";

const databaseUrl = "postgresql://demo:private-demo-password@localhost:5432/careiq_test";

test("database TLS defaults to verified certificates and honors explicit modes", () => {
  const options = connectionOptions({ DATABASE_URL: databaseUrl });
  assert.equal(options.connectionString, databaseUrl);
  assert.equal(options.connectionTimeoutMillis, 10000);
  assert.deepEqual(options.ssl, { rejectUnauthorized: true });
  assert.deepEqual(connectionOptions({ DATABASE_URL: databaseUrl, DATABASE_SSL_MODE: "verify-full" }).ssl, { rejectUnauthorized: true });
  assert.deepEqual(connectionOptions({ DATABASE_URL: databaseUrl, DATABASE_SSL_MODE: "require" }).ssl, { rejectUnauthorized: false });
  assert.equal(connectionOptions({ DATABASE_URL: databaseUrl, DATABASE_SSL_MODE: "disable" }).ssl, false);
});

test("URL parameters cannot override DATABASE_SSL_MODE or expose credentials in errors", () => {
  for (const parameter of [
    "ssl=false",
    "sslmode=disable",
    "sslmode=no-verify",
    "sslmode=verify-full",
    "sslcert=client.pem",
    "sslkey=client-key.pem",
    "sslrootcert=root.pem",
    "sslnegotiation=direct",
    "uselibpqcompat=true",
    "SSLMode=disable",
    "%73slmode=disable",
  ]) {
    for (const mode of [undefined, "disable", "require", "verify-full"]) {
      assert.throws(
        () => connectionOptions({ DATABASE_URL: `${databaseUrl}?${parameter}`, DATABASE_SSL_MODE: mode }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /Remove SSL parameters from DATABASE_URL/);
          assert.match(error.message, /DATABASE_SSL_MODE/);
          assert.equal(error.message.includes("private-demo-password"), false);
          assert.equal(error.message.includes(databaseUrl), false);
          return true;
        },
        `${parameter} must not override ${mode ?? "the default"}`,
      );
    }
  }
});

test("unrelated database URL parameters are retained", () => {
  const url = `${databaseUrl}?application_name=careiq&connect_timeout=10`;
  assert.equal(connectionOptions({ DATABASE_URL: url }).connectionString, url);
});

test("missing or invalid database settings fail without exposing their values", () => {
  assert.throws(() => connectionOptions({}), /DATABASE_URL is not configured/);
  assert.throws(
    () => connectionOptions({ DATABASE_URL: databaseUrl, DATABASE_SSL_MODE: "typo" }),
    /DATABASE_SSL_MODE must be disable, require, or verify-full/,
  );
  assert.throws(
    () => connectionOptions({ DATABASE_URL: "invalid private-demo-password" }),
    { message: "DATABASE_URL must be a valid PostgreSQL connection URL." },
  );
});
