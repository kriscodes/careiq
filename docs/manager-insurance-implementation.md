# Manager dashboard and insurance verification

Local implementation · October 18, 2026

The authenticated CareIQ staff workspace now includes Manager and Insurance views. They use the current practice and explicitly assigned working location, real appointment/patient records, and persisted manual insurance observations. The existing Today, Schedule, Patients, Documents and Forms Studio workflows remain available.

The web design exploration is implemented within the current React workspace and API architecture rather than running its synthetic in-memory backend in the authenticated app. Synthetic records remain confined to the explicit workflow preview and test fixtures.

## Implemented workflow

- Open a location-scoped manager view with server-calculated appointment, review, attention, unassigned and workload counts. The displayed service date and location time zone define the reporting range.
- Export an aggregate-only manager CSV after server authorization and audit capture. It contains dates, snapshot time, time zone and counts, without patient/case/staff identifiers. The audit event confirms release authorization, not a successful browser save.
- Open a paginated insurance queue, review a case, and create a case from an existing active appointment. Search/status/assignee filters apply to explicitly loaded rows; the interface identifies that limit and offers Load more.
- Record a manual payer-portal, phone or document observation with source time, protected reference, reported outcome, reviewer and optional benefits. Blank benefits remain unknown; an entered zero stays zero. Nonactive outcomes do not carry benefit amounts.
- Assign follow-up to an active, assigned local member and set or clear its due time. Removing access does not delete historical attribution.
- Correct a policy reference or evidence using revisions and stable retry keys. Policy changes invalidate the selected result. Evidence corrections append a successor; the original observation is immutable and remains in history.
- Inspect safe case activity and the corresponding patient/appointment activity. Protected audit search/export remains a separate permissioned console.

No live payer adapter is configured. The API refuses electronic check requests rather than manufacturing an eligibility result. Coverage, review completion, authorization, document readiness and payment remain separate. Insurance observations do not change document-readiness rules.

## Evidence applicability

Each new observation retains the payer/member reference and exact appointment instant it was recorded against. Existing historical observations without an appointment snapshot require recheck. An appointment time change or an observation older than seven days produces a derived recheck state while preserving the originally reported outcome and evidence.

Seven days is the current operational recheck default for this manual slice, not a payer benefit rule or guarantee of future coverage. A future practice-approved policy can replace this default. The API and manager queries use the same derived-state rule.

## Permissions and context

Reads require current patient and appointment read permissions plus an active practice, membership, location and assignment. Management additionally requires work management. Recording/correcting evidence additionally requires document-review permission. Case activity separately requires activity-read permission. Manager access does not grant raw audit access or practice membership administration.

The browser receives a fresh organization-scoped token. Changes of organization/location unmount the old workspace, abort outstanding requests, and discard protected details. Server checks run again on every request and idempotent replay. Record revisions prevent stale edits; key reuse with a different payload is rejected.

## Audit actions

See [the audit review](manager-insurance-audit-review.md) for the gap analysis and implemented catalog. The service reuses the protected audit writer and independent database mutation capture. It does not treat a client timeline as the audit authority.

Successful business events and their patient/appointment/case/evidence references commit atomically with the domain change and retry receipt. Database triggers independently record mutation evidence. Failed, denied and rolled-back commands use a separate capture transaction. If required capture is unavailable, protected data/actions are withheld with an unavailable response.

Audit details retain actor, trusted scope, server time, request, transaction, outcome, reason, affected references, revisions and classified changed fields. Member identifiers, payer/source references and benefit values stay out of routine logs and ordinary activity. Safe clinical activity shows only permitted business events; it does not expose denials, command internals or raw database evidence.

## Database changes and release checks

- 0036 adds insurance cases, immutable evidence, scoped relationships, forced RLS, narrow runtime grants, mutation triggers and a protected case-activity projection.
- 0037 adds the five safe insurance business actions to the existing patient/appointment activity projection without broadening its scope or returned columns.
- 0038 preserves appointment applicability snapshots and adds policy/appointment integrity guards and nonactive-benefit constraints. Historical facts are not rewritten.

Applied migration files are unchanged. The release verifier checks the new table grants, forced RLS, mutation/immutability triggers and protected activity helper before production startup. New migrations were applied only to the runner-owned loopback review and test databases.

## Verification and remaining activation

Verification records and synthetic screenshots are under [manager and insurance verification](verification/manager-insurance/README.md). The implemented database/API tests cover actual persistence, tenant/location separation, immutable evidence, corrections, concurrent revisions, retry receipts, audit failure rollback and safe projections. Browser tests cover the rendered workflow and permission states; the real API/browser harness remains isolated from live identities and payer systems.

This work is local only. No commit, remote push, hosted deployment or hosted database migration is included. Live payer selection/credentials/callbacks, production migration/role validation, external identity/browser acceptance, approved freshness/retention policy and broader operational exports remain separately reviewed work. The current member/reference fields are protected clinical PostgreSQL data; this change does not introduce or claim a new envelope-encryption service, claims engine or independent identity verification.
