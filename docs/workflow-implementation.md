# Workflow implementation and local review

Updated October 16, 2026. The implementation is in the existing `/Users/kristian/Documents/Server/CareIQ` checkout. No commit, push, deployment, hosted migration, real patient message or provider configuration change was performed.

## Forms Studio and patient paperwork — October 17

The [Forms Studio implementation guide](forms-studio-implementation.md) records the white guided builder, collapsible navigation, schema v2 publication/freeze, governed demographic review, adult-self signing, patient account access manager and completed-copy library. Migrations 0027–0032 extend the local foundation described below; live email delivery and the other documented external activation work remain gated.

## Popup and visit action refinements

October 17: dialog forms, template editors and footers now share consistent inner spacing; Today rows and dropdown arrows have inset padding. Visit document requirements open an action chooser for review, secure viewing, upload/replacement, requests, existing evidence and reasoned waiver/revocation. Actions preserve the clicked patient, visit, requirement and exact version. See [visual measurements and screenshots](verification/workflow-spacing-2026-10-17/README.md).

## Open the application

The supervised local environment uses the isolated PostgreSQL container on `127.0.0.1:55434` and existing Clerk **test** configuration.

| Review surface | URL |
| --- | --- |
| Interactive staff workflow with clearly labeled synthetic records | [Workflow preview](http://localhost:3101/workflow-preview) |
| Authenticated staff workspace, persistent isolated database | [CareIQ workspace](http://localhost:3101/) |
| Protected audit search, details and exports | [Audit review](http://localhost:3101/audit) |
| API/database health | [Health](http://localhost:3100/health) |

The synthetic preview is an interactive review surface with its own sample adapter. It does not prove a database write or a provider delivery. The authenticated workspace uses the implemented API and PostgreSQL. Existing owner approval, organization membership and assigned-location rules still apply. The new workflow opens for location-based practices; the legacy practice slice remains available for older practices.

From the repository root, select Node.js 22.23.2 (`nvm use` with nvm), then use:

```sh
pnpm local:setup
pnpm local:start
pnpm local:status
```

The runner never uses the original hosted database URL. It applies migrations only to `careiq_review` and `careiq_test`, creates separate restricted clinical and audit-reader logins, and keeps private objects, audit export manifests, cursor secrets and credentials under ignored `.local-review/`. Read [the local environment guide](local-review.md) for ownership-safe restart and stop commands. Original application environment files are preserved.

## Implemented surfaces

| Area | Implemented behavior |
| --- | --- |
| Today and schedule | Location-local dates, document-readiness counts, visit details, booking/editing, legal status transitions, cancellation, overlap and provider availability checks, checklist reconciliation |
| Patient directory | Server search, paged lists, direct profile loading, contact changes, patient-linked visits, documents, requests and activity |
| Document workspace | Private upload reservation and binary transfer, size/hash/type validation, scan quarantine, immutable versions, current version, staff review and correction, exact requirement evidence, waiver/revocation, archive/restore, authenticated byte access |
| Forms and templates | Typed structured field editor, draft revisions, immutable publication, frozen generated PDFs and patient preparation |
| Requests and follow-up | Collection/replacement/signature requests, item-level obligations, due/expiry, reminders and cooldown, reissue/revocation, cancellation, work assignment and completion, truthful delivery status |
| Patient response | Restricted request-only cookie session, frozen signing PDF, consent and typed/drawn signatures on web, typed signatures on native, signed output plus separate evidence, collection upload, decline and safe retries |
| Configuration | Provider catalog/assignments, recurring availability and time-off exceptions, visit/document types, immutable requirement rule publication |
| Audit review | Explicit purpose, scoped search and signed cursors, event/resource/field-change details, separately permitted database evidence, stable snapshot exports and reauthorized downloads |
| Mobile | Native staff navigation, API-backed forms and lists, private file selection/transfer and temporary sharing, restricted patient route and universal-link configuration |

The white-and-blue workflow follows the approved design while retaining the existing authentication, practice setup and settings. Responsive browser verification covers desktop, tablet and narrow phone widths. Native mobile source is now separated for a future repository; earlier bundle exports remain dated evidence, and installed-device acceptance stays separate. See [the mobile handoff](mobile-separation.md).

## Backend and database

Migrations **0019–0026** extend the existing patient and appointment foundation. Domain tables cover providers and availability, catalogs and snapshotted rules, requirements and evidence, documents and immutable file/version records, templates, requests and items, restricted links/sessions, signature packets, consent and evidence, upload/scan attempts, work items, operations/runs, delivery attempts and outbox records. Separate audit tables capture application events, affected resources, classified changes, database mutations, capture policy, archive manifests, retention assignments and holds.

The implementation enforces practice/location/patient relationships with scoped foreign keys, forced row-level security and narrow grants. Provider booking locks and an exclusion constraint prevent overlapping visits. Immutable versions, published rules, consent and audit facts reject ordinary updates/deletes. Mutable records use revisions; stale submissions fail with a conflict. Idempotency fingerprints include actor/scope, command, target, payload and precondition, with current authorization checked again on replay.

Primary lists and histories use bounded database keyset pagination, signed scope/filter-bound cursors and exact totals. Direct detail loading does not depend on the first page. Readiness dependencies are loaded for the selected records, with exact referenced document and review versions. PostgreSQL microseconds are preserved in continuation positions. Full-scope counts are calculated separately from visible pages.

Use these files when reviewing the implementation:

- [Runtime API contract and design departures](design/workflow/runtime-contract.md)
- [OpenAPI 3.1 request/response definitions](api/workflow.openapi.json)
- [Original reviewed schema/API design](design/workflow/schema-and-api-design.md)
- [Approved prototype reference](design/workflow/approved-prototype.html)
- [Database schema](../apps/api/src/db/schema/workflow.ts)
- [Workflow commands and patient response service](../apps/api/src/services/workflow.service.ts)
- [Read model and pagination](../apps/api/src/workflow/read-model.ts)
- [Protected audit service](../apps/api/src/services/protected-audit.service.ts)

## Audit coverage

Application audit records identify the actor, initiating actor/executor where applicable, server time, scope, operation/request/transaction, action, outcome and reason. Related resources include the actual returned record/version IDs. Changes use classification-aware capture: protected values are withheld by default rather than copied into ordinary activity. Independent database triggers record mutation evidence and database identity, including transactions that bypass normal application commands.

Failed, denied and rejected attempts are recorded separately after a failed transaction rolls back. Anonymous invalid link attempts have bounded, non-sensitive evidence. Upload integrity, scan results, review corrections, selected/revoked evidence, template publication, signing consent/source/output/evidence hashes, request link rotation and byte-access grants have separate durable records. A completed HTTP transfer is recorded separately from authorization; it does not assert that a person read or printed a document.

Normal clinical runtime cannot select raw audit tables. Protected review uses an independent reader credential with no clinical table/column access, protected ownership, audit writes, creation rights or privileged transitive role membership. Every search, detail read, export preparation and export access is itself audited. Optional database evidence requires `org:audit:evidence:read`, in addition to `org:audit:read` or `org:audit:export`. A location switch, permission loss or backgrounding clears protected browser results and cancels pending requests. Audit reads have database timeouts. Exports bound event/resource/change/evidence counts and output size; oversized requests require a narrower period.

## Review sequence

1. Open the synthetic preview. Inspect Today, schedule, patient profile/readiness, documents, template editing and configuration. Create/edit a sample patient or appointment and try a stale/failed action in the automated suite.
2. In the authenticated workspace, choose an assigned location. Configure a provider, availability, visit type, document type and published requirement rules. Create a synthetic patient and visit; verify the generated checklist.
3. Create and publish a template, prepare its PDF for that patient, create a signature request and open its one-time **local review** link. Complete consent/signing, then review the new output/evidence and visit readiness. Keep the link private; it grants only the bound request.
4. Try a received document upload. Without an actual scanner installed/configured, the expected result is quarantine. No unscanned upload should become accepted or satisfy a requirement.
5. With an explicitly granted audit role, search a short period with a case reference. Open changes, optionally request database evidence, and prepare/download a snapshot export. Repeat after changing location or revoking assignment to confirm access is rechecked.

Do not use real patient information during this review.

## Local implementation boundaries

These are deliberate review-environment choices and remaining activation work, not successful external integrations:

- **Delivery:** no email/SMS provider is configured. Attempts and outbox records explicitly report provider unavailable; local request links support end-to-end review. No real message is sent.
- **Scanning:** the API accepts a trusted ClamAV-compatible executable through `CAREIQ_SCANNER_COMMAND`. The review runner discovers `clamscan` if installed. Missing, timed-out or failed scanning quarantines the file. The deterministic clean adapter exists only in isolated automated tests.
- **Execution:** scans, PDF generation and signing execute synchronously while durable operation/run records are written. Independent provider workers, delivery reconciliation and retry scheduling require activation before unattended production use.
- **Storage/retention:** private local filesystem objects and 15-minute audit export manifests support local review. External versioned object storage, immutable archival/retention locks, retention-aware orphan reconciliation and approved cleanup/hold execution remain production activation work. No physical audit/document deletion job runs.
- **Signing:** output retains original PDF pages and adds an electronic signing record. It is not a certificate-based cryptographic PDF signature. Assurance is possession of the restricted link, not independent proof of a person's identity.
- **Dependency release gate:** two existing high registry advisories remain on the reviewed node-forge/braces backports. The exploit/integrity regressions pass, but the unsuppressed raw audit still fails. Published fixed versions are unavailable. See [current security notes](security/next-october-2026.md).
- **Provider/device acceptance:** no live Clerk permission changes, email/SMS accounts, production signing identities, app association publishing, store release or physical iOS/Android acceptance was performed. Native bearer authentication remains gated by the existing release policy.

## Verification

See [the verification record](verification/workflow/verification.md) for final commands, counts and limitations. Browser screenshots of synthetic records: [desktop](verification/workflow/desktop.png), [tablet](verification/workflow/tablet.png), [phone](verification/workflow/mobile.png).
