# Local workflow implementation contract

The maintained machine-readable [OpenAPI3.1 contract](../../api/workflow.openapi.json) covers staff, patient and protected audit endpoints.

October 16, 2026. This contract describes the code in this checkout, including explicit departures from the Revision 2 proposal. No hosted migration, message delivery or deployment is included.

The staff base is `/api/v1/locations/{locationId}/workflow`. Existing patients/appointments endpoints retain their original contract. Authentication remains Clerk; every staff call resolves current membership, enrollment and location assignment, then every database transaction rechecks and locks those local grants. Workflow capabilities come from the current provider membership permissions rather than stale token role names. Practice ownership does not confer clinical permission.

Success wraps `data`. All POST and PATCH commands require a UUIDv4 `Idempotency-Key`; mutable updates also require `If-Match: "{revision}"` except reviews, whose body requires `expectedDocumentRevision`. A replay checks current authorization before returning the safe original receipt, including the target and expected revision in its fingerprint. Raw patient link tokens are returned once and excluded from retry storage and audit. A reissue returns a new local review link. Commands return identifiers/state; clients refresh the workspace after mutation.

## Workspace and reads

`GET /workflow` (also `/workspace` without the workflow suffix) returns `location`, `timeZone`, `patients`, `appointments`, `documents`, `templates`, `requests`, `workItems`, `providers`, `visitTypes`, `documentTypes`, `summary`, `capabilities` and `asOf`. Reads use a repeatable database snapshot. Primary collections page independently with a default limit of 50 and maximum of 100. The `pagination` map gives each collection its exact filtered total and a signed continuation cursor bound to actor, practice, location, filters, collection and limit. SQL computes full-scope summary counts independently of the page. The loader reads complete readiness dependencies for selected appointments, including exact current/evidence/request versions that fall outside recent history. `date=YYYY-MM-DD` filters location-local appointment days before paging; `q` filters patient directory search. Ordinary legacy lists retain their original offset contract.

Collection GET paths accept `cursor`, `limit` and applicable `date`, `q` or patient/appointment/document/request filters: `patients`, `appointments`, `documents`, `templates`, `providers`, `visit-types`, `document-types`, `requests`, `work-items`. Patient/appointment/document/template/request detail adds `/{id}`. Patient detail includes that patient's independently paged appointments/documents/requests and pagination metadata; entity detail selects the record directly rather than searching only the initial workspace page. Document and template versions expose `/documents/{id}/versions` and `/templates/{id}/versions` with signed history continuation; initial recent histories have `relatedPagination` metadata. `GET /today?date=YYYY-MM-DD` filters appointments using the location IANA zone. `GET /activity?patientId=&appointmentId=&documentId=&limit=&cursor=` returns the safe clinical audit projection with an actor/filter-bound signed cursor preserving database timestamp precision. `GET /operations/{id}` includes persisted scan/generation run state. Normal clinical APIs cannot read raw audit tables.

Patient DTOs carry camelCase identity/contact fields, `displayName`, `revision` and `concurrency: {revision, ifMatch}`. Appointment DTOs add patient/provider summaries, scheduled/end timestamps, visit type, status, requirements, allowed actions and derived readiness counts. A requirement has separate `lifecycleState` and computed `progressState`, due time, document type, reason codes and exact selected/candidate evidence only for document readers. Appointment readers receive accurate readiness even when they cannot read document bytes or metadata.

Document DTOs include immutable `versions` and `currentVersion`; each version includes `id`, `versionNumber`, `source`, `status`, `sha256`, `originalFilename`, `contentType`, `sizeBytes` and the current review head. File storage keys and bearer grants never appear. Template DTOs include immutable published version content/schema and draft revisions. Request DTOs separate request `state` from `deliveryState` and retain exact items. Work items preserve assignee, due time, kind/state, revision and their domain links.

## Staff commands

| Path | Payload and precondition |
| --- | --- |
| `POST /patients` | firstName, lastName, optional preferredName/email/phone/dateOfBirth |
| `PATCH /patients/{id}` | Changed identity/contact fields or archived boolean; If-Match |
| `POST /appointments` | patientId, providerId, scheduledAt, endsAt, optional visitTypeId/reason; offset-qualified instants |
| `PATCH /appointments/{id}` | Scheduling fields/reason; patient is immutable; If-Match |
| `POST /appointments/{id}/status` | status; If-Match; status-transitions alias available |
| `POST /appointments/{id}/cancellation` | reasonCode, optional note; If-Match; cancellations alias available |
| `POST /appointments/{id}/requirements/reconciliation` | apply:true; If-Match; explicitly adopts current published rules |
| `POST /requirements/{id}/waiver` or `/waiver-revocation` | reasonCode; If-Match |
| `POST /requirements/{id}/evidence` | documentVersionId; If-Match; exact policy/review/signing/freshness validation |
| `POST /document-versions/{id}/reviews` | decision accepted/replacement_required, requirementIds, expectedDocumentRevision, optional reasonCode/note/supersedesReviewId; replacement requires reasonCode |
| `POST /documents/{id}/current-version` | documentVersionId, reasonCode; If-Match; explicitly resolves a clean stale candidate |
| `POST /documents/{id}/archive` or `/restore` | reasonCode required for archive; If-Match |
| `POST /templates` | documentTypeId, title, content, fieldSchema |
| `PATCH /templates/{id}` | title/active; document type immutable; If-Match |
| `POST /templates/{id}/versions` | content, fieldSchema; If-Match on template |
| `PATCH /template-versions/{id}` | content and/or fieldSchema for draft only; If-Match |
| `POST /templates/{id}/publication` | optional versionId; If-Match on template; versions/{versionId}/publication alias |
| `POST /patients/{id}/prepared-documents` | templateVersionId, answers, optional appointmentId/requirementId |
| `POST /patients/{id}/document-requests` | appointmentId, purpose, recipient, items, dueAt/expiresAt, optional assigneeUserId/reasonCode/delivery |
| `POST /requests/{id}/reminders` | optional reasonCode; If-Match; one-hour cooldown |
| `POST /requests/{id}/reissue` | reasonCode; If-Match; rotates/revokes old links and sessions; reissues alias |
| `POST /requests/{id}/cancellation` | reasonCode; If-Match |
| `POST /work-items/{id}/assignment` | assigneeUserId or null; If-Match; assignee must have active location enrollment |
| `POST /work-items/{id}/completion` | reasonCode; If-Match; only non-domain follow-up work can be manually completed |

Request recipient: `{name, channel: "email"|"sms"|"local_review", address?}`. Items: `{requirementId, sourceDocumentVersionId?}`. A signature request has exactly one item and requires an available frozen PDF version. Collection/replacement items derive type and patient from their requirement. `delivery: {sendNow:true}` records an explicit failed provider attempt and private local outbox event when no provider is configured; it never sends a real message. Responses truthfully report `DELIVERY_PROVIDER_UNAVAILABLE`, plus a local `/patient-workflow#token=...` path for review. Request state remains open independently of delivery failure.

Provider scheduling prevents overlaps across locations, validates current assignments and recurring/exceptions availability, and serializes availability changes with bookings using the provider lock. Cancellation closes open requests and obsolete work. A reschedule shifts existing snapshotted requirement/work due dates exactly once; a visit-type change reconciles requirements explicitly in the same transaction. Rules never silently replace an existing checklist on an ordinary reschedule.

Review corrections append a successor and revoke every evidence reference dependent on the previous review, reopening work for all affected visits. Archive revokes selected evidence and restores missing work. Restore grants no new acceptance. No-reuse policies check historical evidence associations, including revoked links.

## Configuration

Configuration requires `org:workflow:configure`, independently of patient access.

- `POST /providers`: `{displayName,status?}`. New providers are assigned to the selected location.
- `PATCH /providers/{id}`: displayName/status, If-Match.
- `POST /providers/{id}/assignment`: `{active:true|false}`, If-Match on provider.
- `POST /providers/{id}/availability`: `{rules:[{isoWeekday,startsAtLocal,endsAtLocal,effectiveFrom,effectiveUntil?}],exceptions:[{startsAt,endsAt,kind,reasonCode?}]}`, If-Match on provider. Saving retires previous windows, preserving history.
- `POST /visit-types`: `{code,name,defaultDurationMinutes}`.
- `POST /document-types`: `{code,name}`.
- `POST /requirement-rule-sets/publication`: `{title,rules:[{documentTypeId,visitTypeId?,locationId?,required,reviewRequired,signatureRequired,reusePolicy,maximumAgeDays?,dueOffsetMinutes?,requiredTemplateVersionId?}]}`. `reusePolicy` defaults to none. Published policy sets are immutable.

Template field schema: array of `{key,label,type,required,options?,page?,x?,y?,width?,height?}`. Stable keys use lowercase letters, digits and underscores. Supported template types are text, textarea, date, checkbox, select and typed_signature. Answers are validated against the exact schema. Generated PDFs contain the frozen template text and answers.

## Private uploads and byte access

`POST /patients/{id}/uploads` (document-uploads alias) reserves `{documentTypeId,requirementId?,existingDocumentId?,baseVersionId?,title?,file:{name,contentType,sizeBytes,sha256}}`. Allowed upload types: PDF, PNG, JPEG; maximum 10 MiB. Returns documentId/documentVersionId/uploadSessionId and a protected PUT upload URL. `PUT /upload-sessions/{id}/content` sends raw bytes. `POST /upload-sessions/{id}/completion` sends optional expected sha256/sizeBytes and runs integrity/type checking and the configured scanner. The raw PUT independently reauthorizes the actor. Reservation retains the exact expected base version. A clean upload whose current head changed returns `promotion: "requires_resolution"` without discarding scan history or overwriting newer content; the explicit current-version command resolves it under a fresh document revision.

`CAREIQ_PRIVATE_STORAGE_DIR` controls private immutable local objects; default `.local-review/private-documents` relative to API working directory. Unique storage keys never come from filenames. Object writes use exclusive creation and restrictive file permissions. Hash/type/size mismatches fail. `CAREIQ_SCANNER_COMMAND` must name a trusted local ClamAV-compatible executable accepting `--no-summary <file>`. Exit 0 means clean, 1 unsafe; unknown/error/timeout/unconfigured means quarantined. Uploads are unreadable until clean. Template/signature/evidence artifacts come from the controlled local renderer and retain renderer provenance; they never claim an external malware scan.

`GET /document-versions/{id}/content?purpose=view|download|print` requires fresh document-read access, records an object/version-specific grant, verifies bytes/hash and proxies the private file. Observed gateway response completion/disconnect is recorded separately; neither grant issuance nor completed response claims that a person read or printed it.

## Restricted patient workflow

Public base: `/api/v1/patient-workflows`, registered before staff authentication. SameSite Strict HttpOnly session cookie, Secure in production; no-store/no-referrer responses, allowed-origin check and bounded per-IP request throttling. Native applications can open the same protected web link.

1. `POST /session-exchanges {token}` exchanges a once-delivered raw link for the restricted cookie. Raw tokens are only SHA-256 hashed in the database. The cookie lives at most one hour and never outlives the request grant.
2. `GET /request` (session alias) returns only the bound request, recipient display name, items and optional signature packet/source hash/consent text/version/required field schema. It cannot list patients or access arbitrary IDs.
3. `GET /document` proxies the exact frozen signing PDF after integrity/access evidence checks.
4. Collection: `POST /uploads {requirementId,file:{name,contentType,sizeBytes,sha256}}`, `PUT /uploads/{id}/content`, `POST /uploads/{id}/completion {sha256,sizeBytes}`. POSTs require Idempotency-Key. The database independently enforces the live request/session scope; unvalidated bytes cannot fulfill items. Final clean completion closes only the bound request and leaves required staff review pending.
5. Signing: `POST /completion {expectedRevision,sourceSha256,consent:{accepted:true,textVersion},fields:[{key:"patient_signature",type:"typed_signature"|"drawn_signature",value}]}` plus Idempotency-Key. Drawn values are PNG data URLs up to 150 KB. Field types must match the packet. Source/consent/revision/expiry are checked under request/packet locks.
6. `POST /decline {reasonCode?}` plus Idempotency-Key closes the request without satisfying requirements.

Signing creates a separate immutable PDF retaining original pages and appending an electronic signing record, plus private JSON evidence with consent text/version/hash, source/output/evidence hashes, entered fields, server time, session/request and renderer version. It does **not** apply or claim a certificate-based cryptographic PDF signature. Recipient assurance is explicitly email-link possession, not real-world identity proof. The signature request becomes completed only after output/evidence are durable. Same-session valid terminal signing, collection-completion and decline retries receive only their original safe receipts; mismatched key/input conflicts. Cancel/expiry/reissue removes live authority. The public database policy permits only exact request source/output versions and request-owned uploads, including same-patient isolation.

## Permissions and audit

Existing patient/appointment read/create permissions remain. New explicit keys: `org:patients:update`, `org:appointments:update`, `org:documents:read`, `org:documents:upload`, `org:documents:review`, `org:documents:archive`, `org:requests:send`, `org:requirements:waive`, `org:requirements:manage`, `org:work:manage`, `org:workflow:configure`, `org:activity:read`. Capabilities/allowedActions guide UI only; all commands enforce authority again.

Commands append accepted and completed audit events atomically with state. Independent row triggers preserve safe field changes and database identity. Failed/denied/rejected HTTP attempts append using a separate transaction after rollback, including anonymous invalid link attempts. Workspace access records actual returned IDs and version IDs in bounded batches before returning protected JSON. Protected audit search/detail/export uses the separate root-owned audit service and reader credential; ordinary runtime has no raw audit SELECT. Production API startup and release verification validate any configured audit reader using the same effective-read, transitive-role, ownership and forbidden-write checks repeated on every audit request; the release command closes the reader pool before exiting. No automatic physical document or audit deletion exists.

Background scans/signature completion execute synchronously in this local implementation while recording operations, runs, scan attempts and results durably. External provider dispatch/reconciliation workers remain activation work; delivery outbox rows explicitly report unavailable and never claim delivery. Source bytes may remain orphaned after a rolled-back filesystem write; no API grant can expose them, and retention-aware orphan reconciliation is required before production operation.

Verification: `workflow-service.test.ts` exercises the actual restricted runtime against an isolated loopback database, including signing PDF/evidence creation, replay conflicts, collection quarantine/clean transitions, corrected review invalidation, readiness, booking conflict, permissions, stale revisions and durable HTTP denial evidence. The deterministic clean test adapter is confined to that test process and never configures the review application.
