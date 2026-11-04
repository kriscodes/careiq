# Forms Studio, patient completion and paperwork library

Updated October 17, 2026. This is the implementation record for the existing `/Users/kristian/Documents/Server/CareIQ` checkout. It extends the [workflow implementation](workflow-implementation.md) and identifies the supported subset of the [approved forms design](design/forms-studio/architecture-and-data-model.md).

The application now includes a white Forms Studio, guided patient completion, frozen PDF output, governed demographic review and an authenticated paperwork library. Migrations **0027–0034** were applied only in the supervised local review/test environment. No commit, push, deployment, hosted database migration, live patient email or identity-provider permission change was performed.

## Supported application experience

Open the local [staff workspace](http://localhost:3101/) and choose an assigned location. **Templates** opens the existing template collection and Forms Studio. The [synthetic workflow preview](http://localhost:3101/workflow-preview) provides a separate sample adapter; its records and interactions do not establish database persistence or real delivery.

| Surface | Implemented behavior |
| --- | --- |
| Staff navigation | The top-bar navigation control collapses or expands the sidebar. Buttons retain accessible labels. Studio focus mode and separate tool/inspector controls provide more editing space. |
| Studio appearance | Existing white surfaces, blue actions, borders, field spacing and padded dropdown components are retained. Staff and patient interface text supports the existing English/Spanish preferences. |
| Guided authoring | Stable field keys/IDs; ordered sections; text, long text, email, phone, date, number, checkbox, select, radio and deferred signature fields; labels/help; choices; required flags; conditional visibility; bounded repeating sections. |
| Review and publication | Save a draft, inspect the patient form, generate an authorized PDF preview and publish an exact revision. Published versions are locked; further editing creates another draft/version. |
| Signing and delivery configuration | Choose `form_only` or `form_then_sign`, versioned consent text, the supported patient signer and whether completion should create a paperwork-email intent. Configuration does not activate an email provider. |
| Patient profile | View completed paperwork, notification follow-up and proposed demographic changes. Authorized staff can manage the separate patient-library account grant. |
| Patient completion | A restricted request link opens the assigned form. Patient answers are saved on the server with revision checks, frozen for review and, when configured and eligible, signed with explicit intent. |
| Patient library | [Patient paperwork](http://localhost:3101/patient-paperwork) requires a verified signed-in account and a current explicit grant. Patients can view/download released completed copies. |

The studio implements guided PDF generation. An imported-PDF overlay editor is not active. The schema rejects unsupported overlay mode/coordinates rather than accepting a layout it cannot render.

Interface language and document language are separate. Changing the interface preference does not translate frozen content, legal wording or an existing signed document. Independently approved translated legal versions and their approval workflow remain future work.

## Publication and frozen source data

Schema v1 remains supported. New Studio forms use schema v2 and retain fields plus the validated `form_schema` on the existing `template_versions` record. The schema includes sections, visibility rules, registered bindings, completion/signing policy, document locale, delivery preference and a server-derived document title.

Every draft mutation requires the existing concurrency precondition. V2 publication also requires `expectedDraftRevision`, in addition to the template's `If-Match` revision. A draft changed after the caller read it cannot silently become the published version. Publication validates the schema and PDF output, records a publication check, freezes approved bindings and hashes the exact content/schema. The published title is retained with the version, so renaming the logical template does not rename paperwork already assigned to a patient.

Server validation rejects unknown fields, duplicate keys, invalid choices, unsupported signer policies and cyclic or impossible rules. Rules use indexed dependency graphs and cached applicability per answer context. Repeating rows have stable IDs, published count limits and independent applicability caches. A large valid dependency graph does not expand into an exponential recursive walk.

Patient saves are revision-bound server commands. `Saved` requires an accepted response; a local edit is insufficient. Hidden/inapplicable answers are removed from the accepted draft and do not enter the frozen PDF, active answer snapshot or chart-change candidates. Making a branch visible again does not restore its old answer as confirmed data. Draft answers and signing images are not written to browser local storage by the new patient flow.

Freeze retains an immutable `form_submissions` fact linked to the prepared document, published version and generated document version. It records applicable answers/field keys, schema/answer hashes, ruleset version, locale, submitting actor and server time. The generated version also retains its structured answers and schema version. A ready prepared document and immutable submission cannot be edited into a different signed source.

The guided renderer preserves supported English/Spanish characters, wraps to actual page width and continues onto additional pages. Unsupported PDF glyphs cause an explicit error; they are not silently replaced in patient names or legal text. Unicode font coverage beyond the current renderer requires additional implementation. Local generation and signing are limited to one hundred total PDF pages, checked before adding another page. Drawn signature PNGs have a 150,000-character data-URL limit, dimensions no greater than 2,048 × 1,024 and no more than 1,048,576 pixels. Chunk extents and bounded decompression are validated before image embedding; animation is rejected and ancillary metadata is removed. These limits reduce local resource expansion and do not replace an isolated production PDF worker.

## Patient completion and signing

A v2 `form_completion` request pins one prepared draft and its published template. It may reference a visit requirement, or be a standalone request for that patient. It does not fabricate a signing source before the patient's answers exist.

1. Staff create the scoped form request and privately open its local review link. The request defaults to seven days and may not exceed the implemented thirty-day limit. A link is exchanged for a request-bound HttpOnly session, capped by the request/grant expiry and the existing session lifetime. One-time grant exchanges are serialized by the token hash across API processes, so concurrent exchange attempts cannot both issue a session.
2. Patient saves validate the exact draft revision and current applicability. Unresolved required fields or failed/stale saves prevent freeze.
3. Freeze validates the final active answers and produces the immutable source PDF/submission. Cancellation, expiry, policy and scope checks apply before the result can proceed.
4. For `form_only`, verified output becomes an **unsigned submitted copy**. No synthetic signature or signing badge is created.
5. For `form_then_sign`, the patient reviews the frozen source and exact versioned consent. Required assigned signature fields are checked before completion. The signing API supports up to thirty assigned fields; a policy with explicit signature fields must include a required field.
6. Completion retains the original PDF pages, appends a paginated electronic signing record and stores separate evidence. The completed version, library publication and any notification intent are committed before the request is closed.

The new v2 signing path supports one required **adult patient signing for themself**. Its current local eligibility boundary is age eighteen through 129, with a known date of birth and an unarchived patient. Age is evaluated on the patient's location-calendar date, using the current database clock. A database helper rechecks the exact live request, frozen patient-role policy, practice/location access and current eligibility at dispatch/freeze and before/after signing render; a patient row lock prevents a concurrent date-of-birth/archive change from defeating that check.

This eligibility boundary is a supported-product restriction, not a universal determination of legal capacity or records-access rights. Minor/proxy/guardian authority, representatives, provider countersignatures and multiple signer roles remain gated. Legacy v1 behavior is preserved; the legacy signature-request endpoint explicitly rejects v2 sources, so it cannot replace frozen v2 consent or required fields with the generic v1 policy.

New v2 sessions, exchange events, signature projections, completion evidence and receipt-access audit events identify the mechanism as `patient_request_link`, with assurance `link_possession`. The verified request purpose selects this method; locally issued links do not claim email delivery or verified identity. Legacy v1 method labels and retained signed copies are preserved.

A new v2 completion also retains its local adult-self eligibility decision: policy version, evaluation timestamp, exact protected practice/location/patient/request/source scope, source hash, decision hash and protected audit-event reference. Completion audit links that decision as its cause. These immutable facts remain after later demographic changes; date of birth, names and raw answers are excluded from ordinary audit metadata. This records the policy check rather than independently establishing identity or universal legal authority.

Signing assurance remains possession of the restricted link. A portal account binding does not upgrade that signature into independently verified signing identity. The PDF has an electronic signing record and integrity hashes; no patient certificate signature, PAdES validation or universal legal-validity finding is claimed. Signing completion also remains separate from staff clinical review and visit-readiness acceptance.

## Governed patient data updates

Published mappings are limited to registered demographic destinations:

- Preferred name.
- Email.
- Phone.
- Date of birth.

Each mapping requires review. Destination type/length limits apply before the proposed value becomes a frozen candidate. Active submitted answers create protected `form_change_candidates`; they never directly overwrite a patient record. Clinical models, insurance extraction, arbitrary table/column bindings and automatic chart acceptance are not implemented.

The staff review queue uses scoped keyset pagination. Accepting a candidate requires document-review and patient-update permissions, the current candidate revision, a fresh patient revision and a reason. Patient-request candidates can only be accepted after that request has completed and its library standing permits use. The registered patient mutation, append-only decision and protected audit reference commit together. A stale chart or already-decided candidate fails rather than overwriting a concurrent change. Rejection retains the source and reason without applying it.

## Library access and grant expiry

Request authority and library authority are separate. Completing one restricted request never grants patient-wide access or creates a portal binding from a matching email/name.

The staff **Patient paperwork access** manager reads, creates and revokes explicit account grants. The account code identifies the patient's authenticated Clerk subject; staff must verify the adult self relationship in person and retain a protected verification reference. A separately verified email destination and explicit paperwork-email preference are required when email is enabled.

Reading or changing these account bindings requires all of `org:workflow:configure`, `org:documents:read` and the dedicated `org:paperwork:manage` permission, plus a signed Clerk first-factor verification age no greater than five minutes. Missing/stale verification fails closed. The UI uses Clerk reverification and offers a refresh after verification; a plain administrator role or a client checkbox does not replace the API checks. These permissions must be configured through the approved identity-provider administration process; this implementation did not change live permissions.

Portal binding, access-manager eligibility, library reads and notification retry use the same private database age rule as v2 self signing: eighteen through 129 on the patient location's calendar date. The runtime receives an authorized eligibility result; it cannot choose an earlier evaluation time or substitute UTC birthday calculations. Missing birth dates, inactive scope or archived patients fail the eligibility check.

The portal grant has an explicit expiry, with a maximum/default of ninety days. The manager displays active, expired and revoked grants, supports reasoned revocation and paged history, and requires an existing unrevoked grant to be revoked before replacement. Sensitive verification references and email destinations are withheld from the grant-list response.

Each patient-library list or byte request reauthorizes the current verified account, live self grant, practice/location and patient state. Expired/revoked grants stop subsequent application reads; a downloaded copy cannot be recalled. Restricted copies are withheld. Voided/superseded records may retain historical status in the list, but the patient byte endpoint serves only a released copy. Content access checks the exact immutable version/file and stored hash before returning bytes through the API. Object storage keys are not exposed to the patient.

## Automatic paperwork-email intent

The completed copy exists in the library independently of email. If the frozen form's `delivery.emailCopy` is true, durable completion creates a deduplicated notification record and existing outbox event referencing the exact library item/version. The outbox contains protected identifiers rather than answers, signatures or a bearer object URL. Missing verified access becomes follow-up; absent email permission is suppressed; a qualified destination still reports `DELIVERY_PROVIDER_UNAVAILABLE` in this local runtime. Provider-unavailable work is not reported as sent/delivered/read.

A staff retry rechecks current grant/expiry, patient eligibility, release standing and communication preference. It records the current result; it does not send a message through an unconfigured provider. When email-copy intent is off, library publication still succeeds and the notification result is `not_requested`.

Actual automatic email delivery requires an approved provider/BAA, sender authentication, minimal first-party sign-in links, dispatch-time permission checks, verified webhooks, bounce/complaint suppression, idempotency and reconciliation. No provider adapter, unattended delivery worker, tracking pixel, routine PDF attachment or real patient email was activated by this change.

## API families

The authoritative payloads, permission requirements and error contracts are in [OpenAPI](api/workflow.openapi.json). Staff routes below are relative to `/api/v1/locations/{locationId}/workflow`; they retain current membership, practice/location authorization, command idempotency and revision checks.

| Purpose | Implemented route family |
| --- | --- |
| Authoring/version history | Existing `/templates`, `/templates/{id}/versions`, `/template-versions/{id}` and template publication routes, extended with schema v2 |
| Validation and PDF preview | `POST /template-versions/{id}/validation`; `POST /template-versions/{id}/preview` |
| Patient form dispatch | `POST /paperwork/requests` |
| Staff completed copies/follow-up | `GET /paperwork/patients/{id}`; `PATCH /paperwork/library-items/{id}/release`; `POST /paperwork/notifications/{id}/retry` |
| Account access manager | `GET/POST /paperwork/patients/{id}/portal-grants`; `POST /paperwork/portal-grants/{id}/revocation` |
| Governed mapping review | `GET /patients/{id}/form-changes`; `POST /form-changes/{id}/decisions` |
| Restricted patient completion | Existing `/api/v1/patient-workflows` session/request/document/completion routes, plus `PUT /form/answers` and `POST /form/freeze` under that prefix |
| Authenticated patient library | `GET /api/v1/patient-paperwork`; `GET /api/v1/patient-paperwork/{id}/content` |

Patient mutation routes retain the existing origin, body-size, rate-limit, HttpOnly-cookie and no-store boundary. Legacy patient upload reservation, content and completion require a collection/replacement request. A form-completion token cannot enter those paths, and the restricted fulfillment helper independently enforces that purpose boundary before looking up an item/version. Library requests use verified account authentication, not the request cookie. Staff review lists, grant history and patient library lists use signed scope-bound cursors with preserved database continuation timestamps.

## Database and audit additions

| Migration | Local change |
| --- | --- |
| `0027_forms-studio-v2` | Validated form schema, immutable submissions/publication checks/bindings/decisions, protected change candidates, forced RLS and source/freeze guards |
| `0028_patient-paperwork` | Form-completion request/item binding, adult-self portal grants, completed-copy library, notification intents, exact-scope helpers and protected publication |
| `0029_paperwork-publication-guards` | Forward publication/helper refinements, including optional-notification behavior |
| `0030_form-completion-receipts` | Terminal form-freeze retry receipts, released-copy byte access and protected portal failure auditing |
| `0031_form-signer-authority` | Current adult-self v2 signing authority and wall-clock expiry checks |
| `0032_location-calendar-eligibility` | One private location-calendar adult-self rule for portal binding/reads, notification retry and v2 signing; scoped staff eligibility helper and current-clock evaluation |
| `0033_patient-fulfillment-purpose` | Restricted legacy fulfillment rejects purposes other than collection/replacement before item/version lookup |
| `0034_patient-request-link-audit` | Forward-only receipt audit correction derives the new v2 link mechanism from the verified request purpose; authorization predicates and receipt payloads are preserved |

Migrations remain append-only. Applied SQL hashes and the migration ledger are preserved; later repairs use a new migration. Schema metadata tracks the same migration chain. These changes do not create a parallel queue, audit authority or patient directory.

New clinical records retain practice/location/patient scope, composite foreign keys, forced RLS and narrow runtime grants. Immutable source facts reject updates/deletes. Database mutation evidence records changes independently of application commands. Publication, frozen submissions, mapping decisions, access binding/revocation, library/notification outcomes and authorized/denied portal access have protected audit paths. Patient answers/signature values remain in protected domain records; ordinary audit metadata uses classified changes and references. Byte authorization is not evidence that a person read the document.

## Local review and remaining activation

Use the [supervised local environment](local-review.md), synthetic records and existing test identities. A practical review is: publish a guided form; dispatch and complete one unsigned form; complete an eligible self-signing form; review a proposed demographic change; establish a separately verified account grant; sign in to the patient library; verify grant expiry/revocation and restricted-copy behavior. Email intent should remain provider-unavailable/suppressed as appropriate, while the authorized library copy remains durable.

Focused tests cover publication conflicts and pinned titles, hidden/repeating answers, graph complexity/cycles, immutable source history, RLS scope, reviewed mutations, exact-copy access, signing authority, terminal retries and PDF glyph/page behavior. Final run results and remaining acceptance work are maintained in the [verification index](verification.md) and [forms review artifacts](verification/forms-studio-2026-10-17/). The [security/load evidence](verification/security-load-2026-10-17/) and [adversarial API matrix](verification/security-load-2026-10-17/api-adversarial-results.json) record the observed exchange race, upload-purpose boundary, file-response crash and resource-bound repairs, along with real negative HTTP and restricted-database checks across multiple synthetic practices/locations.

External versioned object storage, isolated renderer/scanner infrastructure, durable worker scheduling and reconciliation, retention/hold execution, independent audit archives and recovery drills remain activation work. The existing local private-object pipeline and synchronous rendering/signing support local review. Distributed tenant admission and end-to-end API/provider/renderer capacity remain production acceptance work; database throughput measurements alone do not establish them. No physical disposal job runs. Certificate-based signatures, external identity assurance, translated legal approval, special document-category rules and native/hosted acceptance require their own reviewed implementation and verification.
