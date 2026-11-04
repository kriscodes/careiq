# Managed-owner repair: approved scope and evidence

Status: **the user explicitly approved the local repair scope, and implementation and final local release rehearsals pass. See the [final verification record](verification/managed-owner-repair-2026-11-02.md).** The original experiment and grant inventory below document the reviewed scope. The active implementation is additive migration `0049_managed_helper_ownership.sql` plus strict catalog checks in `managed-owner-release-check.ts` and `managed-owner-policy.ts`. Historical migrations 0000–0048 remain unchanged. No hosted database, commit, push or deployment is authorized by this local approval.

Independent review tightened one experimental policy: the audit writer's patient lookup now permits the exact token patient or established clinical location scope, instead of unrestricted private-role patient lookup. This closes same-location cross-patient audit attribution. New integration tests cover the negative case and valid own-patient writes. The active source manifest supersedes the original experimental predicate shown below.

## Reproducible ownership gate

Run `node scripts/test-managed-owner.mjs` from the repository root with Node 22 and Docker available. It creates separate PostgreSQL **18.6** containers for fresh installation and a seeded 49-to-50 upgrade, binds only to loopback, generates disposable credentials, applies all checked migrations as a non-superuser / non-BYPASSRLS owner with CREATEDB and CREATEROLE, repeats the migration runner to check a no-op replay, and verifies every actual public/audit table has that owner. The complete API suite then exercises its existing restricted runtime fixtures. Administrative credentials are limited to synthetic fixture setup; the migration-defined table and helper ownership remains intact.

The runner does not accept a database URL and cannot target a hosted database. A unique container name isolates concurrent runs. Its `finally` block removes that container and its anonymous volume. Test discovery, failures, skips and TODOs are fail-closed; machine-readable results are `.tmp/managed-owner/fresh/tests.json` and `.tmp/managed-owner/upgrade/tests.json`. The small runner unit test also verifies that superuser/bypass ownership, incomplete catalog evidence and wrong table ownership are rejected.

Original baseline verified on November 2, 2026 (America/Los_Angeles):

- All **49** immutable journal entries applied and replayed successfully.
- All **91 actual tables** in public/audit had the restricted owner. The older release record counts 93 relations because its inventory includes views.
- **395 API tests: 367 passed, 28 failed, zero skipped, zero TODO.** The gate exited nonzero and removed its container. Failure counts include failed parent tests; they are not 28 independent root causes.
- The runner unit test passed. No production data or hosted credentials were used.

These reproduce the acceptance limit in [the October 31 rehearsal](verification/managed-owner-release-2026-10-31.md). The baseline gate correctly blocked release. The approved repair now passes both full ownership rehearsals; the final record above supersedes that unresolved status.

## Root cause and affected behavior

Earlier SECURITY DEFINER functions were exercised by CI with a superuser owner. On the managed owner, FORCE ROW LEVEL SECURITY also constrains those functions. Token authentication cannot first discover its request/session scope; patient audit identity checks, portal preferences/paperwork, suppression lookup and patient completion/publication helpers encounter similar visibility gaps. Missing initial authorization/context then produces downstream unavailable-record and duplicate-work failures.

An isolated synthetic experiment reassigned **13 existing helper functions** to five private helper roles and added explicit table/column privileges and role-only row policies. Existing function bodies and their authorization, token expiry/revocation, request binding, consent, version, audit and immutable evidence checks were retained. Before the final health-readiness unit test was added, a run with narrowed patient/document/file metadata grants completed **402 tests: 399 passed, 3 failed, zero skipped or TODO**. The three remaining failures are the release verifier rejecting the new, unreviewed policy inventory (one direct test plus the nested protected-audit test and its parent). Eight previously unreachable subtests now ran. This is evidence for the cause and proposed scope, **not a passing release or completed security review**.

The experiment was only in a task-owned loopback database. Its catalog is recorded below for review; it is not an approved production migration. Private helpers see more rows than a direct runtime identity, so a defect in any helper body could increase access. Function-body integrity and the precise role, grant, policy and caller boundaries must therefore be verified before shipping.

## Approved repair scope

Explicit approval authorized one new additive migration and strict release-verifier checks for the design below. Do not rewrite migrations 0000–0048, disable forced RLS, use superuser/BYPASSRLS owners, add these privileges to the ordinary runtime role or expose helper roles to application logins.

Each of the five roles must have NOLOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOREPLICATION and NOINHERIT; no inherited role memberships; schema USAGE only, without CREATE. Runtime logins and inherited runtime roles must have neither membership nor SET ROLE access. The migration owner may retain role administration with INHERIT FALSE / SET FALSE after ownership transfer, following the existing availability-reader pattern. Temporary transfer membership must be removed or made non-inheritable/non-settable before the transaction completes.

Every reassigned helper remains SECURITY DEFINER with the fixed search path `pg_catalog, public, pg_temp`. Existing reviewed function bodies stay unchanged. PUBLIC EXECUTE must be revoked. Preserve only existing application entry-point EXECUTE grants, and explicitly grant the migration owner/internal helpers the minimum calls necessary for nested functions and triggers. Ownership transfer must preserve those calls; an implicit old-owner EXECUTE privilege disappears when ownership changes.

The experiment uses private SELECT policies with `true` where token/portal bootstrap must establish an identity before ordinary tenant policies can apply. Those policies are restricted to the named private role, never PUBLIC or runtime. Mutation policies must retain patient/request or clinical-scope checks. Lock-only UPDATE(id) privileges exist solely for existing SELECT FOR SHARE; their added policies have WITH CHECK false. Broad existing role grants must still be reviewed against exact function references before activation.

## Required acceptance before merging the repair

1. Build the additive migration from the checked SQL definitions and reviewed grant inventory; do not promote an ad-hoc catalog dump into a migration.
2. Replay it fresh and as an upgrade using the real restricted owner, preserve the historical migration hashes, and verify a second replay changes nothing.
3. Extend the release verifier to enforce exact role attributes, memberships, schema privileges, function owners, fixed search paths, body hashes, EXECUTE grants, table/column ACLs and policy expressions. Do not merely ignore the new policy names or relax the old policy-count check.
4. Add catalog-tampering rejection tests and restricted-runtime negative tests for direct helper-role assumption, cross-practice/location/patient access, fabricated token/portal context, expired/revoked grants, immutable receipts, wrong-purpose requests, denied writes and unreviewed column grants.
5. Run the full managed-owner suite with zero failures/skips/TODO, the existing superuser-fixture suite, release verification, API source/test typechecking and existing migration immutability checks. The final record confirms that these acceptance tests pass; the earlier three verifier failures are historical evidence.

Automatic approval review initially rejected creating the active migration because its exact ownership/grant/RLS scope had not been explicitly authorized. The user subsequently approved the concrete local repair and verification scope documented here, resolving that checkpoint. Commit, push, hosted database access and deployment remain separately unauthorized.

## Experimental function ownership (13 functions)

| Private role                  | Existing function                                                            | Body SHA-256                                                       |
| ----------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `careiq_patient_audit_writer` | `audit.record_event(jsonb,jsonb,jsonb)`                                      | `d42d3de9f8c5b55156f0bd83c97fe458240f58aea8292a1cd033c8a447afe902` |
| `careiq_patient_operator`     | `careiq_form_completion_guard()`                                             | `87f6149c037506b2b477dce9b3ffb14c9a57882171f2659a694b5be9a9761dc6` |
| `careiq_patient_operator`     | `careiq_form_signer_authorized(uuid)`                                        | `0d3b17800f43052d0d897fc92863009a96587c63f393d090f410613f7dfe507c` |
| `careiq_patient_operator`     | `careiq_patient_close_request(text)`                                         | `b5f362a0674d8500716d4f197b65f76119b1e3dc28bc9c4c92e788f9d02b9477` |
| `careiq_patient_operator`     | `careiq_patient_fulfill_item(uuid,uuid)`                                     | `c6e0fc38cea52f8e21e81e3da9fee5e00bf69241de052b4fc38851d05a88ddad` |
| `careiq_patient_operator`     | `careiq_publish_completed_paperwork(uuid,uuid,boolean)`                      | `2c4f9f01c41c9b9ce0b3a09a5bc9bf82e60f84a403f3d0843326b1f92b792789` |
| `careiq_portal_operator`      | `careiq_communication_profile_changed()`                                     | `ed270666b7bfa523a38224d2e965444062bd0d104a18d965b4422bf380d3e0e7` |
| `careiq_portal_operator`      | `careiq_portal_communication_choices(uuid,jsonb,bigint,text,text,uuid,text)` | `91577b191bf9a25859561e56883b451d2538ac0bd284fb6e319009a9f1c2ca97` |
| `careiq_portal_operator`      | `careiq_portal_paperwork(uuid,boolean,timestamp with time zone,uuid)`        | `b081c28993f4b786f6aea0406acddcbea62ea5c113676cc50fec15f21d997db9` |
| `careiq_suppression_reader`   | `careiq_delivery_destination_suppressed(text,text,text)`                     | `67670b1c29820500a6084fa4936fe66b7f4389373f6ab76a8df17cef57e11908` |
| `careiq_token_lookup`         | `careiq_patient_command_receipt(text,text)`                                  | `0b95b4b4f0846f8fddc39272b78f74ac49b476182a7e7b1ee47507bae16aac4f` |
| `careiq_token_lookup`         | `careiq_patient_completion_receipt(text)`                                    | `e69e71376d4c571967845e33262a8c4174d244ed6348a1f03a9be6acea0484cc` |
| `careiq_token_lookup`         | `careiq_resolve_patient_access(text,boolean)`                                | `42b40650a22dd7baabae1539f7188f02dd68d6d45465f6671c2ef58032f889e7` |

The hashes above identify the unchanged bodies in the experiment. A production verifier should derive its expectations from reviewed versioned SQL, including normalization rules, instead of trusting a live catalog.

## Exact experimental grants

These are explicit privileges on the five private roles; PUBLIC privileges and existing application entry-point grants are not reproduced here. Each role has USAGE on public; all except the suppression reader also have USAGE on audit. None has schema CREATE.

### `careiq_token_lookup`

| Relation                       | Table privileges |
| ------------------------------ | ---------------- |
| `audit.event_resources`        | INSERT           |
| `audit.events`                 | INSERT           |
| `public.workflow_operations`   | SELECT           |
| `public.workflow_request_keys` | SELECT           |

| Relation                       | Column privilege | Columns                                                                                                                                  |
| ------------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `audit.events`                 | SELECT           | `id`                                                                                                                                     |
| `public.document_requests`     | SELECT           | `expires_at`, `id`, `location_id`, `patient_id`, `practice_id`, `purpose`, `revision`, `state`                                           |
| `public.locations`             | SELECT           | `id`, `practice_id`, `status`                                                                                                            |
| `public.patient_access_grants` | SELECT           | `consumed_at`, `expires_at`, `id`, `location_id`, `patient_id`, `practice_id`, `request_id`, `revoked_at`, `token_hash`                  |
| `public.patient_sessions`      | SELECT           | `expires_at`, `grant_id`, `id`, `location_id`, `patient_id`, `practice_id`, `request_id`, `request_revision`, `revoked_at`, `token_hash` |
| `public.practices`             | SELECT           | `id`, `status`                                                                                                                           |

Explicit helper calls / owned function EXECUTE:

- `careiq_patient_command_receipt(text,text)`
- `careiq_patient_completion_receipt(text)`
- `careiq_resolve_patient_access(text,boolean)`

### `careiq_portal_operator`

| Relation                                   | Table privileges |
| ------------------------------------------ | ---------------- |
| `audit.event_resources`                    | INSERT           |
| `audit.events`                             | INSERT           |
| `public.communication_endpoints`           | SELECT           |
| `public.communication_permission_events`   | INSERT, SELECT   |
| `public.destination_suppression_releases`  | SELECT           |
| `public.destination_suppressions`          | SELECT           |
| `public.location_assignments`              | SELECT           |
| `public.locations`                         | SELECT           |
| `public.paperwork_library_items`           | SELECT           |
| `public.patient_portal_grants`             | SELECT           |
| `public.portal_communication_profiles`     | INSERT, SELECT   |
| `public.portal_communication_request_keys` | INSERT, SELECT   |
| `public.practice_member_access`            | SELECT           |
| `public.practices`                         | SELECT           |

| Relation                               | Column privilege | Columns                                                                                                                         |
| -------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `audit.events`                         | SELECT           | `id`                                                                                                                            |
| `public.communication_endpoints`       | UPDATE           | `id`                                                                                                                            |
| `public.file_objects`                  | SELECT           | `detected_media_type`, `id`, `location_id`, `original_filename`, `patient_id`, `practice_id`, `sha256`, `status`, `storage_key` |
| `public.patient_portal_grants`         | UPDATE           | `id`                                                                                                                            |
| `public.patients`                      | SELECT           | `archived_at`, `date_of_birth`, `id`, `location_id`, `practice_id`                                                              |
| `public.patients`                      | UPDATE           | `id`                                                                                                                            |
| `public.portal_communication_profiles` | UPDATE           | `revision`, `updated_at`                                                                                                        |

Explicit helper calls / owned function EXECUTE:

- `audit.capture_mutation()`
- `audit.record_event(jsonb,jsonb,jsonb)`
- `careiq_adult_self_eligible_at(date,text,timestamp with time zone)`
- `careiq_communication_profile_changed()`
- `careiq_portal_communication_choices(uuid,jsonb,bigint,text,text,uuid,text)`
- `careiq_portal_paperwork(uuid,boolean,timestamp with time zone,uuid)`
- `careiq_resolve_patient_access(text,boolean)`

### `careiq_patient_operator`

| Relation                                 | Table privileges       |
| ---------------------------------------- | ---------------------- |
| `public.appointments`                    | SELECT                 |
| `public.communication_endpoints`         | SELECT                 |
| `public.communication_permission_events` | SELECT                 |
| `public.document_request_items`          | SELECT, UPDATE         |
| `public.document_requests`               | SELECT, UPDATE         |
| `public.document_reviews`                | SELECT                 |
| `public.document_versions`               | SELECT                 |
| `public.location_assignments`            | SELECT                 |
| `public.locations`                       | SELECT                 |
| `public.outbox_events`                   | INSERT, SELECT         |
| `public.paperwork_library_items`         | INSERT, SELECT         |
| `public.paperwork_notifications`         | INSERT, SELECT         |
| `public.patient_portal_grants`           | SELECT                 |
| `public.practice_member_access`          | SELECT                 |
| `public.practices`                       | SELECT                 |
| `public.prepared_documents`              | SELECT                 |
| `public.requirement_evidence`            | INSERT, SELECT, UPDATE |
| `public.signature_packets`               | SELECT                 |
| `public.visit_requirements`              | SELECT, UPDATE         |
| `public.work_items`                      | INSERT, SELECT, UPDATE |

| Relation                   | Column privilege | Columns                                                                                            |
| -------------------------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| `public.documents`         | SELECT           | `archived_at`, `document_type_id`, `id`, `location_id`, `patient_id`, `practice_id`, `title`       |
| `public.file_objects`      | SELECT           | `id`, `location_id`, `patient_id`, `practice_id`, `sha256`, `status`, `storage_key`, `verified_at` |
| `public.patients`          | SELECT           | `archived_at`, `date_of_birth`, `id`, `location_id`, `practice_id`                                 |
| `public.patients`          | UPDATE           | `id`                                                                                               |
| `public.template_versions` | SELECT           | `form_schema`, `id`, `practice_id`, `schema_version`                                               |

Explicit helper calls / owned function EXECUTE:

- `audit.record_event(jsonb,jsonb,jsonb)`
- `careiq_adult_self_eligible_at(date,text,timestamp with time zone)`
- `careiq_form_completion_guard()`
- `careiq_form_signer_authorized(uuid)`
- `careiq_patient_close_request(text)`
- `careiq_patient_form_scope(uuid)`
- `careiq_patient_fulfill_item(uuid,uuid)`
- `careiq_patient_scope(text,jsonb)`
- `careiq_publish_completed_paperwork(uuid,uuid,boolean)`
- `careiq_resolve_patient_access(text,boolean)`
- `careiq_workflow_practice_scope(uuid)`

### `careiq_patient_audit_writer`

| Relation                        | Table privileges |
| ------------------------------- | ---------------- |
| `audit.changes`                 | INSERT           |
| `audit.event_resources`         | INSERT           |
| `audit.events`                  | INSERT           |
| `public.location_assignments`   | SELECT           |
| `public.locations`              | SELECT           |
| `public.practice_member_access` | SELECT           |
| `public.practices`              | SELECT           |

| Relation          | Column privilege | Columns                            |
| ----------------- | ---------------- | ---------------------------------- |
| `public.patients` | SELECT           | `id`, `location_id`, `practice_id` |

Explicit helper calls / owned function EXECUTE:

- `audit.record_event(jsonb,jsonb,jsonb)`
- `careiq_resolve_patient_access(text,boolean)`

### `careiq_suppression_reader`

| Relation                                  | Table privileges |
| ----------------------------------------- | ---------------- |
| `public.destination_suppression_releases` | SELECT           |
| `public.destination_suppressions`         | SELECT           |
| `public.location_assignments`             | SELECT           |
| `public.locations`                        | SELECT           |
| `public.practice_member_access`           | SELECT           |
| `public.practices`                        | SELECT           |

Explicit helper calls / owned function EXECUTE:

- `careiq_delivery_destination_suppressed(text,text,text)`
- `careiq_resolve_patient_access(text,boolean)`

## Exact experimental role-only policies (67)

The policy predicates below are catalog evidence, not executable migration instructions. Policies remain permissive additions for the specified private role. Existing runtime policies remain unchanged.

### `careiq_token_lookup`

**`managed_receipt_resources_insert` — INSERT** on `audit.event_resources`.

WITH CHECK:

```text
true
```

**`managed_receipt_audit_insert` — INSERT** on `audit.events`.

WITH CHECK:

```text
((actor_type = 'patient_session'::text) AND ((action)::text = ANY ((ARRAY['signatures.completion.receipt_access'::character varying, 'patient_commands.receipt_access'::character varying])::text[])))
```

**`managed_receipt_audit_returning` — SELECT** on `audit.events`.

USING:

```text
((actor_type = 'patient_session'::text) AND ((action)::text = ANY ((ARRAY['signatures.completion.receipt_access'::character varying, 'patient_commands.receipt_access'::character varying])::text[])))
```

**`managed_token_lookup` — SELECT** on `public.document_requests`, `public.locations`, `public.patient_access_grants`, `public.patient_sessions`, `public.practices`.

USING:

```text
true
```

**`managed_token_receipts` — SELECT** on `public.workflow_operations`, `public.workflow_request_keys`.

USING:

```text
true
```

### `careiq_portal_operator`

**`managed_portal_resources_insert` — INSERT** on `audit.event_resources`.

WITH CHECK:

```text
true
```

**`managed_portal_audit_insert` — INSERT** on `audit.events`.

WITH CHECK:

```text
((actor_id = current_setting('app.portal_subject'::text, true)) AND (actor_type = 'user'::text))
```

**`managed_portal_audit_returning` — SELECT** on `audit.events`.

USING:

```text
((actor_id = current_setting('app.portal_subject'::text, true)) AND (actor_type = 'user'::text))
```

**`managed_portal_lock` — UPDATE** on `public.communication_endpoints`, `public.patient_portal_grants`, `public.patients`.

USING:

```text
true
```

WITH CHECK:

```text
false
```

**`managed_portal_select` — SELECT** on `public.communication_endpoints`, `public.communication_permission_events`, `public.destination_suppression_releases`, `public.destination_suppressions`, `public.file_objects`, `public.locations`, `public.paperwork_library_items`, `public.patient_portal_grants`, `public.patients`, `public.portal_communication_profiles`, `public.portal_communication_request_keys`, `public.practices`.

USING:

```text
true
```

**`managed_portal_consent_insert` — INSERT** on `public.communication_permission_events`.

WITH CHECK:

```text
((source = 'patient_portal'::text) AND (actor_user_id = current_setting('app.portal_subject'::text, true)))
```

**`managed_portal_profile_insert` — INSERT** on `public.portal_communication_profiles`.

WITH CHECK:

```text
(EXISTS ( SELECT 1
   FROM patient_portal_grants g
  WHERE ((g.id = portal_communication_profiles.grant_id) AND (g.patient_id = portal_communication_profiles.patient_id) AND (g.practice_id = portal_communication_profiles.practice_id) AND (g.location_id = portal_communication_profiles.location_id) AND (g.clerk_user_id = current_setting('app.portal_subject'::text, true)) AND (g.revoked_at IS NULL) AND (g.expires_at > now()))))
```

**`managed_portal_profile_update` — UPDATE** on `public.portal_communication_profiles`.

USING:

```text
true
```

WITH CHECK:

```text
true
```

**`managed_portal_receipt_insert` — INSERT** on `public.portal_communication_request_keys`.

WITH CHECK:

```text
true
```

### `careiq_patient_operator`

**`managed_patient_select` — SELECT** on `public.appointments`, `public.communication_endpoints`, `public.communication_permission_events`, `public.document_request_items`, `public.document_requests`, `public.document_reviews`, `public.document_versions`, `public.documents`, `public.file_objects`, `public.outbox_events`, `public.paperwork_library_items`, `public.paperwork_notifications`, `public.patient_portal_grants`, `public.patients`, `public.prepared_documents`, `public.requirement_evidence`, `public.signature_packets`, `public.template_versions`, `public.visit_requirements`, `public.work_items`.

USING:

```text
true
```

**`managed_patient_write` — ALL** on `public.document_request_items`.

USING:

```text
(COALESCE((careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text))), false) OR (EXISTS ( SELECT 1
   FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
  WHERE ((((access.access ->> 'practice_id'::text))::uuid = document_request_items.practice_id) AND (((access.access ->> 'location_id'::text))::uuid = document_request_items.location_id) AND (((access.access ->> 'patient_id'::text))::uuid = document_request_items.patient_id)))))
```

WITH CHECK:

```text
(COALESCE((careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text))), false) OR (EXISTS ( SELECT 1
   FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
  WHERE ((((access.access ->> 'practice_id'::text))::uuid = document_request_items.practice_id) AND (((access.access ->> 'location_id'::text))::uuid = document_request_items.location_id) AND (((access.access ->> 'patient_id'::text))::uuid = document_request_items.patient_id)))))
```

**`managed_patient_write` — ALL** on `public.document_requests`.

USING:

```text
(COALESCE((careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text))), false) OR (EXISTS ( SELECT 1
   FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
  WHERE ((((access.access ->> 'practice_id'::text))::uuid = document_requests.practice_id) AND (((access.access ->> 'location_id'::text))::uuid = document_requests.location_id) AND (((access.access ->> 'patient_id'::text))::uuid = document_requests.patient_id)))))
```

WITH CHECK:

```text
(COALESCE((careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text))), false) OR (EXISTS ( SELECT 1
   FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
  WHERE ((((access.access ->> 'practice_id'::text))::uuid = document_requests.practice_id) AND (((access.access ->> 'location_id'::text))::uuid = document_requests.location_id) AND (((access.access ->> 'patient_id'::text))::uuid = document_requests.patient_id)))))
```

**`managed_patient_write` — ALL** on `public.outbox_events`.

USING:

```text
(COALESCE((careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text))), false) OR (EXISTS ( SELECT 1
   FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
  WHERE ((((access.access ->> 'practice_id'::text))::uuid = outbox_events.practice_id) AND (((access.access ->> 'location_id'::text))::uuid = outbox_events.location_id) AND (((access.access ->> 'request_id'::text))::uuid = outbox_events.patient_request_id)))))
```

WITH CHECK:

```text
(COALESCE((careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text))), false) OR (EXISTS ( SELECT 1
   FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
  WHERE ((((access.access ->> 'practice_id'::text))::uuid = outbox_events.practice_id) AND (((access.access ->> 'location_id'::text))::uuid = outbox_events.location_id) AND (((access.access ->> 'request_id'::text))::uuid = outbox_events.patient_request_id)))))
```

**`managed_patient_write` — ALL** on `public.paperwork_library_items`.

USING:

```text
(COALESCE((careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text))), false) OR (EXISTS ( SELECT 1
   FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
  WHERE ((((access.access ->> 'practice_id'::text))::uuid = paperwork_library_items.practice_id) AND (((access.access ->> 'location_id'::text))::uuid = paperwork_library_items.location_id) AND (((access.access ->> 'patient_id'::text))::uuid = paperwork_library_items.patient_id)))))
```

WITH CHECK:

```text
(COALESCE((careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text))), false) OR (EXISTS ( SELECT 1
   FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
  WHERE ((((access.access ->> 'practice_id'::text))::uuid = paperwork_library_items.practice_id) AND (((access.access ->> 'location_id'::text))::uuid = paperwork_library_items.location_id) AND (((access.access ->> 'patient_id'::text))::uuid = paperwork_library_items.patient_id)))))
```

**`managed_patient_write` — ALL** on `public.paperwork_notifications`.

USING:

```text
(COALESCE((careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text))), false) OR (EXISTS ( SELECT 1
   FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
  WHERE ((((access.access ->> 'practice_id'::text))::uuid = paperwork_notifications.practice_id) AND (((access.access ->> 'location_id'::text))::uuid = paperwork_notifications.location_id) AND (((access.access ->> 'patient_id'::text))::uuid = paperwork_notifications.patient_id)))))
```

WITH CHECK:

```text
(COALESCE((careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text))), false) OR (EXISTS ( SELECT 1
   FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
  WHERE ((((access.access ->> 'practice_id'::text))::uuid = paperwork_notifications.practice_id) AND (((access.access ->> 'location_id'::text))::uuid = paperwork_notifications.location_id) AND (((access.access ->> 'patient_id'::text))::uuid = paperwork_notifications.patient_id)))))
```

**`managed_patient_lock` — UPDATE** on `public.patients`.

USING:

```text
true
```

WITH CHECK:

```text
false
```

**`managed_patient_write` — ALL** on `public.requirement_evidence`.

USING:

```text
(COALESCE((careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text))), false) OR (EXISTS ( SELECT 1
   FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
  WHERE ((((access.access ->> 'practice_id'::text))::uuid = requirement_evidence.practice_id) AND (((access.access ->> 'location_id'::text))::uuid = requirement_evidence.location_id) AND (((access.access ->> 'patient_id'::text))::uuid = requirement_evidence.patient_id)))))
```

WITH CHECK:

```text
(COALESCE((careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text))), false) OR (EXISTS ( SELECT 1
   FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
  WHERE ((((access.access ->> 'practice_id'::text))::uuid = requirement_evidence.practice_id) AND (((access.access ->> 'location_id'::text))::uuid = requirement_evidence.location_id) AND (((access.access ->> 'patient_id'::text))::uuid = requirement_evidence.patient_id)))))
```

**`managed_patient_write` — ALL** on `public.visit_requirements`.

USING:

```text
(COALESCE((careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text))), false) OR (EXISTS ( SELECT 1
   FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
  WHERE ((((access.access ->> 'practice_id'::text))::uuid = visit_requirements.practice_id) AND (((access.access ->> 'location_id'::text))::uuid = visit_requirements.location_id) AND (((access.access ->> 'patient_id'::text))::uuid = visit_requirements.patient_id)))))
```

WITH CHECK:

```text
(COALESCE((careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text))), false) OR (EXISTS ( SELECT 1
   FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
  WHERE ((((access.access ->> 'practice_id'::text))::uuid = visit_requirements.practice_id) AND (((access.access ->> 'location_id'::text))::uuid = visit_requirements.location_id) AND (((access.access ->> 'patient_id'::text))::uuid = visit_requirements.patient_id)))))
```

**`managed_patient_write` — ALL** on `public.work_items`.

USING:

```text
(COALESCE((careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text))), false) OR (EXISTS ( SELECT 1
   FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
  WHERE ((((access.access ->> 'practice_id'::text))::uuid = work_items.practice_id) AND (((access.access ->> 'location_id'::text))::uuid = work_items.location_id) AND (((access.access ->> 'patient_id'::text))::uuid = work_items.patient_id)))))
```

WITH CHECK:

```text
(COALESCE((careiq_clinical_scope(practice_id, location_id) AND (location_id = careiq_context_uuid('app.location_id'::text))), false) OR (EXISTS ( SELECT 1
   FROM careiq_resolve_patient_access(NULLIF(current_setting('app.patient_token_hash'::text, true), ''::text), true) access(access)
  WHERE ((((access.access ->> 'practice_id'::text))::uuid = work_items.practice_id) AND (((access.access ->> 'location_id'::text))::uuid = work_items.location_id) AND (((access.access ->> 'patient_id'::text))::uuid = work_items.patient_id)))))
```

### `careiq_patient_audit_writer`

**`managed_event_change_insert` — INSERT** on `audit.changes`.

WITH CHECK:

```text
true
```

**`managed_event_resource_insert` — INSERT** on `audit.event_resources`.

WITH CHECK:

```text
true
```

**`managed_event_insert` — INSERT** on `audit.events`.

WITH CHECK:

```text
true
```

**`managed_audit_patient_identity` — SELECT** on `public.patients`.

USING:

```text
true
```

### `careiq_suppression_reader`

**`managed_suppression_release_read` — SELECT** on `public.destination_suppression_releases`.

USING:

```text
true
```

**`managed_suppression_read` — SELECT** on `public.destination_suppressions`.

USING:

```text
true
```

## Remaining work

The additive repair and exact catalog verifier are implemented. The original 28-failure baseline remains historical evidence, not the result of the repaired code. Final fresh-database and preserved-data upgrade rehearsals pass and are recorded below; publishing or deployment requires separate authorization.

## Final local acceptance

The approved repair passed **464/464 API tests** in each fresh and upgraded restricted-owner database, with zero skips or TODOs. The ordinary all-workspace run passed **614/614**, changed-code coverage is **94.68%**, and all existing coverage floors pass. Sixty-one focused permission regressions are included. Historical migration bytes, existing helper bodies and seeded records remain intact. See the [final record](verification/managed-owner-repair-2026-11-02.md) for evidence and the migration-50 rollback compatibility limit. The original experiment above remains historical evidence, not the active manifest.
