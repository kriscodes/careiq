import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { availabilityInput, availableSlots } from "../src/workflow/availability.js";
import { WorkflowError } from "../src/workflow/policy.js";
import { isolatedTestDatabaseUrl } from "./local-test-database.js";
import { verifyAvailabilityDatabaseRelease } from "../src/db/availability-release-check.js";
const providerId = randomUUID();

test("availability rejects malformed, repeated and unknown query values before querying records", () => {
  assert.deepEqual(availabilityInput({ providerId, date: "2027-01-04", durationMinutes: "30" }), { providerId, date: "2027-01-04", durationMinutes: 30 });
  for (const input of [
    { providerId, date: "2027-02-29", durationMinutes: "30" }, { providerId, date: ["2027-01-04"], durationMinutes: "30" },
    { providerId: "invalid", date: "2027-01-04", durationMinutes: "30" }, { providerId, date: "2027-01-04", durationMinutes: "4" },
    { providerId, date: "2027-01-04", durationMinutes: "481" }, { providerId, date: "2027-01-04", durationMinutes: "30.5" },
    { providerId, date: "2027-01-04", durationMinutes: ["30"] }, { providerId, date: "2027-01-04", durationMinutes: "30", locationId: randomUUID() },
    { providerId, date: "2027-01-04", durationMinutes: "30", excludeAppointmentId: "invalid" },
  ]) assert.throws(() => availabilityInput(input), error => error instanceof WorkflowError && [400, 422].includes(error.status));
});

const url = isolatedTestDatabaseUrl();
test("slot suggestions share booking rules, exceptions, conflict boundaries and practice time zones", { skip: !url }, async () => {
  const pool = new Pool({ connectionString: url, ssl: false }); const client = await pool.connect();
  const practiceId = randomUUID(), locationId = randomUUID(), otherLocation = randomUUID(), provider = randomUUID(), patient = randomUUID(), occupied = randomUUID();
  const tenant = { practiceId, locationId, userId: "synthetic-slot-test" };
  const ownPatient = randomUUID(), ownAppointment = randomUUID(), detachedProvider = randomUUID(), foreignPractice = randomUUID(), foreignProvider = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO practices(id,clerk_org_id,name,authorization_mode,status) VALUES($1,$2,'Synthetic slots','location','active')", [practiceId, `org_${practiceId}`]);
    await client.query("INSERT INTO locations(id,practice_id,name,time_zone) VALUES($1,$3,'Synthetic clinic','America/Los_Angeles'),($2,$3,'Other clinic','America/Los_Angeles')", [locationId, otherLocation, practiceId]);
    await client.query("INSERT INTO providers(id,practice_id,display_name,status) VALUES($1,$2,'Synthetic provider','active')", [provider, practiceId]);
    await client.query("INSERT INTO provider_locations(practice_id,location_id,provider_id) VALUES($1,$2,$4),($1,$3,$4)", [practiceId, locationId, otherLocation, provider]);
    await client.query("INSERT INTO patients(id,practice_id,location_id,first_name,last_name) VALUES($1,$2,$3,'Synthetic','Slots')", [patient, practiceId, otherLocation]);
    await client.query("INSERT INTO provider_availability_rules(practice_id,location_id,provider_id,iso_weekday,starts_at_local,ends_at_local,effective_from,effective_until) VALUES($1,$2,$3,1,'09:00','12:00','2027-01-01','2027-12-31')", [practiceId, locationId, provider]);
    await client.query("INSERT INTO provider_availability_exceptions(practice_id,location_id,provider_id,starts_at,ends_at,kind) VALUES($1,$2,$3,'2027-01-04T18:30Z','2027-01-04T19:00Z','unavailable'),($1,$2,$3,'2027-01-04T21:00Z','2027-01-04T22:00Z','available')", [practiceId, locationId, provider]);
    await client.query("INSERT INTO appointments(id,practice_id,location_id,patient_id,provider_id,scheduled_at,ends_at,status) VALUES($1,$2,$3,$4,$5,'2027-01-04T17:30Z','2027-01-04T18:00Z','scheduled')", [occupied, practiceId, otherLocation, patient, provider]);
    await client.query("INSERT INTO patients(id,practice_id,location_id,first_name,last_name) VALUES($1,$2,$3,'Synthetic','Current location')", [ownPatient, practiceId, locationId]);
    await client.query("INSERT INTO appointments(id,practice_id,location_id,patient_id,provider_id,scheduled_at,ends_at,status) VALUES($1,$2,$3,$4,$5,'2027-01-04T19:30Z','2027-01-04T20:00Z','scheduled')", [ownAppointment, practiceId, locationId, ownPatient, provider]);
    await client.query("INSERT INTO practice_member_access(practice_id,user_id,membership_id,status) VALUES($1,$2,'synthetic-membership','active')", [practiceId, tenant.userId]);
    await client.query("INSERT INTO location_assignments(practice_id,user_id,location_id,active,granted_by) VALUES($1,$2,$3,true,$2)", [practiceId, tenant.userId, locationId]);
    await client.query("INSERT INTO providers(id,practice_id,display_name,status) VALUES($1,$2,'Synthetic detached','active')", [detachedProvider, practiceId]);
    await client.query("INSERT INTO practices(id,clerk_org_id,name,authorization_mode,status) VALUES($1,$2,'Synthetic foreign','location','active')", [foreignPractice, `org_${foreignPractice}`]);
    await client.query("INSERT INTO providers(id,practice_id,display_name,status) VALUES($1,$2,'Synthetic foreign','active')", [foreignProvider, foreignPractice]);
    await client.query("SELECT set_config('app.practice_id',$1,true),set_config('app.location_id',$2,true),set_config('app.actor_user_id',$3,true)", [practiceId, locationId, tenant.userId]);
    const metadata = (await client.query("SELECT prosecdef,proconfig,has_function_privilege('careiq_clinical_runtime',oid,'EXECUTE') AS runtime_execute,EXISTS(SELECT 1 FROM aclexplode(proacl) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute FROM pg_proc WHERE oid='public.careiq_provider_slot_busy(uuid,timestamptz,timestamptz,uuid)'::regprocedure")).rows[0];
    assert.equal(metadata.prosecdef, true); assert.equal(metadata.runtime_execute, true); assert.equal(metadata.public_execute, false);
    assert.deepEqual(metadata.proconfig, ["search_path=pg_catalog, public, pg_temp"]);
    const query = { providerId: provider, date: "2027-01-04", durationMinutes: 30 };
    const slots = await availableSlots(client, tenant, query); const starts = slots.map(slot => slot.startsAt);
    assert.ok(starts.includes("2027-01-04T17:00:00.000Z")); // Adjacent to a booking at a different location.
    assert.equal(starts.includes("2027-01-04T17:15:00.000Z"), false); assert.equal(starts.includes("2027-01-04T17:30:00.000Z"), false);
    assert.ok(starts.includes("2027-01-04T18:00:00.000Z")); assert.equal(starts.includes("2027-01-04T18:15:00.000Z"), false);
    assert.equal(starts.includes("2027-01-04T18:30:00.000Z"), false); assert.ok(starts.includes("2027-01-04T19:00:00.000Z"));
    assert.ok(starts.includes("2027-01-04T21:00:00.000Z")); assert.equal(starts.includes("2027-01-04T22:00:00.000Z"), false);
    assert.ok((await availableSlots(client, tenant, { ...query, excludeAppointmentId: ownAppointment })).some(slot => slot.startsAt === "2027-01-04T19:30:00.000Z"));
    assert.deepEqual(await availableSlots(client, { ...tenant, practiceId: randomUUID() }, query), []);
    assert.deepEqual(await availableSlots(client, tenant, { ...query, date: "2028-01-03" }), []);
    assert.ok(slots.length <= 96); assert.ok(slots.every(slot => Date.parse(slot.endsAt) - Date.parse(slot.startsAt) === 30 * 60000));
    // The clinical role cannot see the foreign-location booking, but its busy bit still blocks suggestions.
    await client.query("SET LOCAL ROLE careiq_clinical_runtime");
    await verifyAvailabilityDatabaseRelease(client);
    assert.equal((await client.query("SELECT id FROM appointments WHERE id=$1", [occupied])).rowCount, 0);
    const restrictedSlots = await availableSlots(client, tenant, query);
    assert.equal(restrictedSlots.some(slot => slot.startsAt === "2027-01-04T17:30:00.000Z"), false);
    assert.ok(restrictedSlots.some(slot => slot.startsAt === "2027-01-04T18:00:00.000Z"));
    assert.equal((await client.query("SELECT public.careiq_provider_slot_busy($1,'2027-01-04T17:30Z','2027-01-04T18:00Z') AS busy", [provider])).rows[0].busy, true);
    const denied = async (providerValue: string, excludeValue: string | null = null) => {
      await client.query("SAVEPOINT denied_scope");
      await assert.rejects(client.query("SELECT public.careiq_provider_slot_busy($1,'2027-01-04T17:30Z','2027-01-04T18:00Z',$2)", [providerValue, excludeValue]), error => (error as { code: string }).code === "42501");
      await client.query("ROLLBACK TO SAVEPOINT denied_scope"); await client.query("RELEASE SAVEPOINT denied_scope");
    };
    await denied(detachedProvider); await denied(foreignProvider); await denied(provider, occupied);
    for (const [setting, wrong, original] of [["app.actor_user_id", "synthetic-unassigned", tenant.userId], ["app.location_id", otherLocation, locationId], ["app.practice_id", foreignPractice, practiceId]]) {
      await client.query("SELECT set_config($1,$2,true)", [setting, wrong]); await denied(provider); await client.query("SELECT set_config($1,$2,true)", [setting, original]);
    }
    await client.query("RESET ROLE");
    // No invented availability on empty days, or malformed DST local times.
    assert.deepEqual(await availableSlots(client, tenant, { ...query, date: "2027-01-05" }), []);
    await client.query("INSERT INTO provider_availability_rules(practice_id,location_id,provider_id,iso_weekday,starts_at_local,ends_at_local,effective_from) VALUES($1,$2,$3,7,'00:00','04:00','2026-01-01')", [practiceId, locationId, provider]);
    const spring = await availableSlots(client, tenant, { ...query, date: "2027-03-14" });
    assert.equal(spring.length, 11); // 00:00–01:45, 03:00–03:30; the gap has no candidates.
    const autumn = await availableSlots(client, tenant, { ...query, date: "2026-11-01" });
    assert.equal(autumn.some(slot => ["08", "09"].includes(slot.startsAt.slice(11, 13))), false); // Both repeated 1am instants stay out of local-input booking.
  } finally { await client.query("ROLLBACK"); client.release(); await pool.end(); }
});


test("availability routes enforce current read scope and editing authority before exclusions", async () => {
  const previous = { url: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL_MODE };
  process.env.DATABASE_URL = "postgresql://synthetic:synthetic@127.0.0.1:1/careiq_test"; process.env.DATABASE_SSL_MODE = "disable";
  const [{ default: express }, { registerWorkflowRoutes }] = await Promise.all([import("express"), import("../src/routes/workflow.js")]);
  const locationId = randomUUID(), practiceId = randomUUID(); let reads = 0; const permissions: string[] = [];
  const tenant = { practiceId, locationId, userId: "synthetic-slot-route", membershipId: "synthetic-member", orgId: "synthetic-org" };
  const access = { authorizeLocation: async (_auth: unknown, requested: string) => { if (requested !== locationId) throw new WorkflowError("LOCATION_ACCESS_DENIED", 403); return { tenant, capabilities: {}, permissions }; } };
  const deps = { availability: async (scope: unknown, input: unknown) => { reads++; assert.equal(scope, tenant); assert.equal((input as { durationMinutes: number }).durationMinutes, 30); return { slots: [] }; } };
  const app = express(); registerWorkflowRoutes(app, deps as never, access as never, () => ({ userId: tenant.userId }) as never);
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const path = `/api/v1/locations/${locationId}/workflow/availability?providerId=${providerId}&date=2027-01-04&durationMinutes=30`;
  try {
    assert.equal((await fetch(origin + path)).status, 403); assert.equal(reads, 0);
    permissions.push("org:appointments:read");
    assert.equal((await fetch(origin + path)).status, 200); assert.equal(reads, 1);
    assert.equal((await fetch(origin + path + `&excludeAppointmentId=${randomUUID()}`)).status, 403); assert.equal(reads, 1);
    permissions.push("org:appointments:update");
    assert.equal((await fetch(origin + path + `&excludeAppointmentId=${randomUUID()}`)).status, 200); assert.equal(reads, 2);
    for (const suffix of ["&providerId=duplicate", "&date=2027-01-05", "&durationMinutes=30", "&unknown=value"]) assert.equal((await fetch(origin + path + suffix)).status, 400);
    assert.equal((await fetch(origin + path.replace(locationId, randomUUID()))).status, 403); assert.equal(reads, 2);
    permissions.length = 0;
    assert.equal((await fetch(origin + path)).status, 403); assert.equal(reads, 2);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    const { pool: auditPool } = await import("../src/db/client.js"); await auditPool.end();
    if (previous.url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous.url;
    if (previous.ssl === undefined) delete process.env.DATABASE_SSL_MODE; else process.env.DATABASE_SSL_MODE = previous.ssl;
  }
});
