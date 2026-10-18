# CareIQ Forms Security Audit and Delivery Plan

Design proposal · October 17, 2026 · Implementation and activation work remain separate

The form builder must preserve an exact, reviewable chain from published template and patient answers through consent, required signer evidence, immutable completed bytes, chart review and patient delivery. Each boundary enforces authorization independently. A completed PDF is available in the application after durable completion; automatic email is a separately governed delivery operation.

This plan extends existing locally implemented workflow/audit controls. It does not certify regulatory compliance, legal validity or production readiness. Current legal/technical references are attached to the claims they support; the concrete controls below are proposed CareIQ engineering requirements.

## Security boundaries and activation policy

Use strong authenticated staff accounts and the current Clerk permission/location model. Require step-up or recent authentication for high-impact publication, mapping approval, representative authority changes, signer replacement, signed-document voiding and protected exports according to a reviewed policy. A login alone does not prove that a person has authority to sign for a patient.

Restricted completion links are one-request/round/signer credentials. Patient portal accounts require an explicit verified binding to patient records and current audience grants. Email-link possession is recorded as such. Email challenges do not become independent MFA merely because a second code is sent to the same mailbox. NIST's current digital-identity guidance excludes email as an out-of-band authenticator; any NIST assurance claim needs a complete applicable implementation assessment. [NIST authenticator requirements](https://pages.nist.gov/800-63-4/sp800-63b/authenticators/).

HIPAA's technical-safeguard requirements cover access control, audit controls, integrity, person/entity authentication and transmission security. CareIQ's design maps controls to those areas without claiming that one software feature establishes compliance. [45 CFR 164.312](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-C/section-164.312).

## Threat and control matrix

| Threat or failure | Proposed control | Evidence and required verification |
| --- | --- | --- |
| Cross-practice or cross-location record substitution | Current staff permission/enrollment/assignment checks; explicit selected location; forced RLS; composite tenant/location/patient FKs; no broad owner exception | Raw runtime-role queries and API ID substitution fail, including same-location wrong-patient references |
| Patient token used to enumerate records | Separate patient principal/API; request/round/signer-bound grant and session; constrained RLS and exact source/output access | Patient session fails staff API, arbitrary patient/request, other round and other signer's fields |
| Forwarded email or shared inbox reveals records | Notification link requires authenticated account/current explicit grant; link possession alone has limited documented assurance; no automatic email-based account binding | Forwarded notification cannot display bytes; matching email does not establish patient/proxy access |
| Stolen or guessed workflow link | High-entropy random token, hash-only storage, one-time exchange, short session, bounded rate limits, revocation, generic failures | Replay after consumption/reissue/cancel/expiry fails; logs/referrers contain no raw token |
| Lower assurance substituted during service failure | Frozen required-assurance policy; fresh verification bound to signer/round; fail closed; assisted/paper alternative | Missing verifier, insufficient method, expired challenge and changed representative authority block acknowledgement |
| Parent/representative exceeds authority | Explicit scoped authority record and reviewer evidence; category/expiry/revocation limits; separate signing versus viewing grants | Minor/confidential-category and proxy-revocation scenarios deny overbroad access; no family-wide wildcard |
| Template or answers change after signing starts | Immutable published template/submission/source; frozen conditional applicability and signer roles; revision/hash agreement | Concurrent answer/layout/consent change fails; new round requires fresh acknowledgement |
| Required signer omitted or extra signature field accepted | Server derives frozen required roles/fields; all-required-signer gate; assigned fields only; versioned signing policy | Patient-only signature cannot complete required provider/guardian packet; hidden required-signature bypass fails |
| Changed recipient inherits an old signature | New grant/session; identity/authority or substantive changes create new round; no copying signature acknowledgements | Original recipient/session loses live authority; replacement does not reuse acknowledgement |
| Duplicate clicks/jobs cause duplicate completed copies | Scoped idempotency plus durable operation/round business uniqueness; common locks; fencing leases | Replayed completion and lost-worker retry resolve to the same final result |
| Completion races cancellation or expiry | Same request/round locks; conditional terminal transitions; clear pending versus completing expiry rule | One terminal winner; cancelled round cannot publish later; completed copy needs reasoned amendment |
| Database commit succeeds while object write fails | Staged finalization; immutable unique writes; verify exact storage versions/length/hashes before final commit | No completed state/library/email without durable output and evidence; crash resumes same operation |
| Object exists but DB rolls back | Private unreferenced objects; no grants before accepted DB reference; retention-aware orphan reconciliation | Orphan cannot be fetched through API; hold-aware reconciliation preserves signed/evidence objects |
| Tampered file or missing evidence | Server hash/length verification, version IDs, readable output check, detached manifest; verification report and protected incident | Mismatch blocks release/finalization; stale successful report cannot mask latest failure |
| Fake “verified” signature badge | Separate integrity, required signers, identity, CareIQ attestation and certificate findings; no legal-validity badge | Current link-possession record shows its actual assurance; absent cert remains not_present |
| Malicious PDF, image or template | Allowed types; detect bytes/type; quotas/page/object/image limits; quarantine; scanner; sandbox parser/renderer with no network or credentials | Test active content, oversized/decompression bombs, corrupt/encrypted/unsupported PDFs and scanner timeout; no unsafe preview |
| XSS or server execution through form content | Validated declarative schema; sanitization/escaping; no arbitrary JS/HTML/CSS/SQL; no remote URLs in renderer; bounded rule graph | Script/event-handler/SSRF/file-URL payloads rejected; rendering cannot reach metadata endpoints or local secrets |
| PDF import sanitization invalidates an outside signature | Preserve original immutable source; derivatives clearly separate; do not edit signed originals; record signature-check outcomes | Original bytes/hash retained; sanitized preview never presented as certificate-valid original |
| PHI enters logs, analytics or monitoring | Allowlisted structured operational logs; protected evidence references; no body/token/signature/answer snapshots; no third-party analytics/session replay on protected flows | Automated log-redaction checks plus manual incident trace; safe error codes and request IDs only |
| PHI exposed in email | Minimal subject/body; no default attachments; authenticated fixed-origin link; no tracking pixels; verified destination and current category preference | Captured synthetic provider payload contains no patient/form/diagnosis/answer/signature data or direct object link |
| Email already accepted when permission changes | Fresh pre-dispatch check and serialized intent/state update; record actual side-effect boundary; reconcile in-flight outcome | Queued eligible attempts suppress after withdrawal; already accepted message honestly remains an external disclosure fact |
| Duplicate or ambiguous provider send | Provider idempotency where available; stable attempt keys; query/reconcile unknown outcome before retry | Timeout before/after acceptance does not create uncontrolled resend; unknown remains visible if not resolvable |
| Spoofed/reordered webhook | Raw-body signature/timestamp validation, provider-account/event dedupe, existing message-to-attempt mapping and explicit event transitions | Invalid/unmatched/stale/replayed events do not alter tenant records; late bounce preserved after delivery |
| Notification failure hides a completed copy | In-app library publication independent of email; follow-up work and safe patient access | Bounce/suppression/provider outage leaves exact authorized completed copy accessible |
| Auto-mapping overwrites clinical facts | Approved versioned binding registry; patient-reported source; reviewer authority; destination-revision check | Allergy/medication answers create candidates; stale chart revision conflicts; no direct arbitrary field update |
| Hidden or reordered conditional answers silently update records | Server-evaluated published applicability; inactive values excluded from frozen active answers/rendering/mappings; stable repeat-item IDs and bounded limits | Hide a previously answered branch and reorder/delete repeated items: no stale value or positional substitution appears in submitted content/candidates; re-shown values require confirmation |
| Interrupted save or premature signing loses patient input | Server-revision-confirmed save status; pending/failed-save gate; inline/focused validation; fresh same-request authority to resume server draft | Offline/expired-session/stale-save tests never show false Saved/completed; no PHI browser persistence or revoked-grant revival |
| Patient draft is treated as an already signable source | Explicit v2 form-completion stage; pinned scoped draft/template; durable verified freeze with atomic source/submission/round binding and fencing | A stale/cancelled freeze cannot activate signing; no round/presentation before source readiness; form-only submission is never shown signed |
| Privileged runtime alters history | Append-only grants/triggers; protected audit owner; separate reader; independent immutable archive/manifests and access logs | Runtime cannot modify history/disable triggers/change capture policy; privileged changes remain attributable where observable |
| Audit failure loses denied or rolled-back attempts | Mutation audit/DB evidence atomic with changes; denials/failures written after rollback through separate writer/sink; durable read event before content | Simulated sink/trigger failure blocks protected write/read release, preserves denial and alerts/reconciles |
| Data leaves devices or shared browser storage | No PHI in localStorage; scoped memory caches; clear on sign-out/scope change/background per policy; private temporary native sharing and cleanup | Back/navigation/session revocation, user switch and stale-response races cannot restore prior records |
| Unauthorized retention/disposal | Approved per-class policy, holds, no routine physical purge, separate disposition role, object version/lock references | Active hold blocks document/evidence/audit/orphan disposal; classification and approval recorded |
| Backup or key loss destroys evidence | Encrypted tested backups, DB/object consistency reconciliation, separate key controls/rotation, historic verification keys, disaster recovery drills | Restore reconstructs exact signed versions and evidence; key compromise procedure distinguishes signing-time versus later findings |
| Infrastructure/vendor compromise or excessive access | Least-privilege service accounts, secret manager/KMS, restricted egress, access review, patching/SBOM, BAA/subprocessor review and incident response | Provider inventory, current dependencies, scoped credentials, restore/risk assessment and incident exercises before live PHI |

File-upload controls are defense in depth: validation, size/type restrictions, private storage, antivirus/sandbox and content disarm where appropriate do not make every arbitrary PDF safe. Preserve originals when producing derivatives, especially if an original may contain a cryptographic signature. [OWASP upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).

## Audit model and event catalog

Reuse the current `audit.events`, `audit.event_resources`, `audit.changes` and `audit.database_records`. The event catalog below names proposed coverage; map to existing canonical action names during implementation rather than double-log the same business event under two authorities.

Every event includes trusted server occurrence/recorded times, actor kind and stable identity, initiator/executor where different, verified practice/location/patient relationships when resolved, action/outcome/reason, exact affected resource/version IDs, server request ID, operation/run and causation IDs, authorization/capture-policy version and bounded safe metadata. User-provided timestamps and claimed scope remain separately labeled, never promoted to verified facts.

| Event family | Required facts | Safe customer activity |
| --- | --- | --- |
| Template draft create/update/clone | Template/version, draft revisions, changed field paths and validation policy | “Template updated” with version |
| Asset upload/validation/scan/preview | Exact object/version, type/length/hash, scan/render attempt and verdict | Processing/blocked/ready status; no scanner internals |
| Template validation/publication/retirement | Draft hash/revision, exact check, locales, legal/signing policies, approving actor | “Version 4 published”; prior requests retain version |
| Mapping create/approve/retire | Binding version, destination operation, authority and review rules | Configuration change when permitted |
| Patient draft save/freeze/submit | Draft/submission/template, revision/answer hash, source version, locale/provenance | “Paperwork submitted”; no answer values |
| Verification challenge/result | Signer/session/round, required/actual method, result and trusted verifier | “Identity check complete” only under proper policy |
| Representative authority grant/review/revoke | Person/relationship, limited scope/effective time, evidence reference, reviewer/reason | Limited proxy status; sensitive details withheld |
| Consent present/accept/withdraw/revoke | Category, exact text/version/hash/language, signer/role/server time and effective withdrawal | Category-specific consent status |
| Signature field/intent acknowledgement | Exact round/source/submission/consent, assigned fields, role, current assurance and timestamp | “Signature received”; no signature image/value |
| Signing operation start/retry/result | Operation/run/attempt/lease, exact inputs, artifact versions/hashes, safe failure | “Preparing copy” then “Copy ready” only after commit |
| Packet decline/cancel/expire/invalidate | Exact round and reason, revoked grants/sessions, terminal race result | Accurate remaining/signing status |
| Document verification | Exact versions and hashes, check/policy/time, findings/currentness, attestation/cert metadata if supported | Independent findings, no legal validity guarantee |
| Amendment/void/supersession | Original and successor versions, reason/authority/time, evidence/readiness invalidations | “Amended” with authorized original/successor links |
| Chart candidate decision/application | Submission field/binding, destination and base/result revision, reviewer/reason | “Contact updated from paperwork”; clinical detail permission-filtered |
| Library publication/restriction | Exact version, audience/policy, authority and release time | “Available in paperwork” for authorized recipient |
| Communication preference change | Purpose/channel/locale, previous/new state under capture policy, verified contact reference, effective time | Preference status without exposing another destination |
| Notification queue/suppress/dispatch/reconcile | Exact completed version/library item, permission decision, attempt/provider reference, outcome | Queued/accepted/delivery failed; no send claim from queue |
| Provider callback/bounce/complaint | Verified receipt, existing attempt mapping, source/receipt times and dedupe | Delivery outcome; no provider payload |
| Document access/transfer/view report | Authorized principal/purpose/grant, exact returned version, observed transfer outcome; client observation labeled | “Downloaded” only if supported by actual gateway outcome; no claim person read/printed |
| Audit search/detail/export/read | Explicit purpose, actor/scope/filter, selected IDs/snapshot, reader authority and result | Normally protected; no patient-facing forensic feed |
| Retention/hold/disposition/restore | Policy/anchor/hold, authority, manifest/object versions, execution outcome and approval | Restricted administrative status |
| Denied/rejected/failed security attempt | Verified actor/scope if known, bounded error/action, claimed context separately, request ID | No ordinary activity leak; protected review |

Independent database triggers record actual changed table/row/revision/field paths, row-derived scope, transaction and actual database login/execution role. They can capture operator/migration writes without a normal application command. Trigger evidence proves a database change, not a person's real-world identity. Application intent and trigger evidence must correlate without overwriting earlier event links in multi-command transactions.

Protected reads and file grants require durable audit before returning content. Record the actual selected resource IDs and immutable versions, not pagination look-ahead rows. Read/transfer/view are distinct observations. Denied/rejected attempts and failed transactions need a separate writer transaction or durable sink after rollback because database-trigger effects roll back with their transaction. [PostgreSQL trigger semantics](https://www.postgresql.org/docs/current/trigger-definition.html).

Normal clinical runtime cannot select raw forensic audit or update/delete it. Audit-reader rights remain independent and minimal; audit access and export download are themselves audited and reauthorized. Do not use a client endpoint that accepts arbitrary audit content. Evidence exports require purpose, current scope, bounded size and separately audited access.

Append-only application rules and checksums do not make a privileged operator mathematically incapable of tampering. Separately controlled object retention, sealed archive manifests, key governance, external access evidence and tested reconciliation provide stronger detectability. Preserve the scope of that assurance in review reports.

## Data classification and encryption

Protect answers, signatures, identity/authority documents, IP/device evidence when approved, email addresses, patient IDs, document titles and storage metadata according to classification. Do not assume metadata is harmless. Encrypt in transit and at rest, including backups and temporary staging; separate key access from storage access, rotate credentials, protect secrets and document key-recovery procedures. Per-tenant keys can be a later risk/operational choice; a tenant key does not replace RLS and command authorization.

External providers that create, receive, maintain or transmit ePHI need appropriate agreement and safeguards under the actual relationship; HHS notes that a cloud provider storing encrypted ePHI can still be a business associate even without the decryption key. A signed BAA and encryption do not alone satisfy every obligation. [HHS cloud guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/health-information-technology/cloud-computing/index.html).

Use synthetic fixtures for designs, tests and previews. No real patient records, signing links, provider credentials or signature images belong in Notion design pages, issue bodies, screenshots or public preview assets. A reusable template source is patient-free practice content; an uploaded completed patient form must never become a shared template accidentally.

## Email operational controls

1. The signed document reaches completed only after all required signer acknowledgements and verified output/evidence objects exist. In the same final transaction, publish the exact patient-accessible version and create a unique notification intent/outbox event.
2. Resolve the current intended recipient and explicit audience grant. Verify destination and purpose-specific communication policy/confidentiality restrictions. A general electronic-signature consent is not permission for every email or proxy disclosure.
3. Build a minimal locale-appropriate subject/body with a first-party authenticated link. Interface/email language may change without changing the frozen document/legal language. Default notifications contain no attachment, patient name, document category, answer or signature. Disable tracking pixels/link rewriting.
4. Check policy again immediately before dispatch. Configure approved sender-domain controls including SPF, DKIM and DMARC alignment as supported by the chosen service; use least-privilege provider credentials, provider idempotency if supported, bounded retries and queue latency monitoring. No external call occurs inside a long-running database transaction pretending it is atomic with the provider.
5. Persist each actual call and uncertain result. If the provider outcome is ambiguous, reconcile/query before retry; if impossible, retain `unknown` and staff follow-up. Record provider acceptance separately from delivery.
6. Verify signed callbacks, deduplicate and preserve all delivery/bounce/complaint events. Suppress future automatic attempts after permanent rejection and create actionable staff work; never move a completed document back to unsigned.
7. The app displays the exact completed copy even if email fails. Staff see notification state and can initiate an authorized resend or alternative channel. Patient-specific unencrypted attachment requests follow a separate approved access process and risk acknowledgement.

Receipt safeguards and alternative communication choices matter even with a minimal email. [HHS email guidance](https://www.hhs.gov/hipaa/for-professionals/faq/does-hipaa-permit-health-care-providers-to-use-email-to-discuss-health-issues-with-patients/index.html). No live email or provider configuration is performed by this task.

## Acceptance criteria

These are required future implementation checks, not tests executed for the design artifact.

1. Using the actual non-owner runtime role, verify every new table/route/job against cross-practice, cross-location and same-location wrong-patient substitutions. Missing context and owner-without-clinical-grant deny. A request session cannot access another request, source, output or signer belonging to the same patient.
2. Remove membership/permission/location/portal/proxy authority during active sessions, idempotent replay, content transfer authorization and finalization. New actions fail under the documented freshness policy; committed facts remain. Cache/context switches and pooled transactions do not resurrect access.
3. Published templates/translations, frozen submissions/sources, accepted signer facts and finalized output/evidence reject ordinary updates/deletes. New versions do not modify existing requests. Preview fixture data cannot satisfy a real requirement.
4. Concurrent template saves return 412 without losing client draft input. A stale publication check fails. Unknown/looping conditional logic, unreachable required fields, missing signer assignments and malformed geometry block publication.
5. Keyboard/screen-reader completion, mobile reflow, visible required/optional distinction and English/Spanish paths work. App locale changes leave frozen legal/document language unchanged. Unavailable approved translation/assurance offers an explicit alternative.
6. Required patient plus provider or representative policies cannot complete with one signature. Each signer can submit only assigned fields and acknowledges the exact assigned immutable presentation version/hash. Sequential presentation generation is durable, scope-bound and complete before the next signer becomes ready; stale or substituted presentations fail. A declined/revoked/expired/insufficient signer prevents completion.
7. Email challenge, account authentication, representative verification, typed name, drawn mark and certificate result retain distinct labels. No unsupported method obtains a higher assurance label. Minimum policy failure never silently downgrades.
8. For every signature race, duplicate click and retry after transport-key expiry, one business completion exists. Kill execution around the last required acknowledgement transaction: either that acknowledgement and its finalization operation/outbox all commit, or none commit. Earlier signer facts remain intact. Same key with different target/body/precondition conflicts. Old worker fencing token cannot finalize after a successor claims the job.
9. Crash after output write, after evidence write, before DB finalization, after finalization and before email result. Resume safely; never show completed without durable verified artifacts; orphan bytes stay private and hold-aware.
10. Race cancellation, pending expiry, all-signers acknowledgement and completion. One terminal outcome wins. Already-completing expiry behavior matches the published policy; explicit cancellation can prevent later publication if it wins before final commit.
11. Change answers, signer identity/authority or substantive consent. A successor round requires fresh signatures; original records remain. Completed originals cannot be erased by cancellation or regenerated from newer chart facts.
12. Tamper with source/output/evidence or remove an object version. Verification reports mismatch/unavailable, blocks unsafe content/finalization and records incident evidence. Old green findings become stale/failed rather than masking the issue.
13. If a CareIQ evidence seal is implemented, verify its key/algorithm against trusted configuration and preserve historic key verification. Clearly distinguish it from a patient's PDF certificate signature. Unsupported or stale certificate/revocation checks report indeterminate/unsupported with actual check time.
14. Unsafe, encrypted/unsupported, malformed, over-limit, script-bearing and image/decompression-bomb uploads fail closed or remain quarantined. Scanner timeout/unavailable never becomes clean. Parser/renderer cannot access network, file URLs, cloud metadata or application credentials.
15. External signed original remains immutable when sanitized preview/OCR derivatives are generated. Derivatives retain provenance and never claim to preserve an original certificate signature automatically.
16. A signed form with a new phone and allergy creates appropriate candidates. Contact approval honors destination revision. Allergy/medication updates require domain reviewer authority; rejection/conflict preserve source and decision history.
17. Completed paperwork creates one exact-version library item and eligible notification intent. Email provider outage, bounce or suppressed preference leaves the copy available and creates truthful follow-up. No notification is sent for a partial signature or failed finalization.
18. Inspect synthetic email payloads and URLs: no PHI-bearing subject/body, attachments, direct object URL, tracking pixel or token leakage by default. A forwarded link requires authentication/current audience grant. Incorrect or unverified destination blocks automatic delivery.
19. Withdraw preference or proxy authority while queued. Dispatch suppresses eligible attempts. Change during provider call records the actual boundary/outcome honestly. Notification resend targets current approved contact and the same immutable completed copy.
20. Provider timeout before/after acceptance, duplicated/reordered callbacks and late bounce/complaint preserve event history and do not cause uncontrolled resend or false delivery. Unmatched/forged webhook cannot assert tenant context.
21. Protected reads/audit exports/byte grants record exact resource/version access before release; completed transfer and client-view reports remain separate. Audit-sink failure blocks required content/mutations and emits durable recovery evidence.
22. Application and independent DB evidence reconcile to actual business mutations, operator changes, denied attempts and job runs. Runtime cannot alter audit/capture policy/trigger ownership; raw answers/signatures/tokens never appear in routine logs/activity.
23. Retention/holds prevent document, submission, signing evidence, audit and orphan deletion where required. No universal PDF retention assumption. Restore a consistent DB/object/evidence set and verify historic signatures/references with retired keys retained for verification.
24. Staff sidebar collapse preserves the current patient/practice/location and unsaved draft, announces state/accessibility labels, retains keyboard navigation and does not change authorization. Desktop preference persists per user/device; patient mobile navigation does not inherit the staff rail.
25. Before production pilot, document selected provider BAAs, access reviews, scanner/renderer restrictions, domain authentication, monitoring/incident procedures, dependency release gate, retention policy and native/device acceptance. Local review success alone cannot mark these complete.
26. Answer a conditional branch, hide it, then freeze and approve mappings. Its inactive values do not enter the final active answers, PDF or candidates; showing it again requires confirmation. Stable repeat IDs survive reorder/deletion, with bounded counts/depth/payload and wrong-item substitutions rejected.
27. Interrupt draft saves, reorder responses, trigger validation failure and expire/revoke the session. Saved reflects only the accepted revision; freeze/signing cannot outrun a pending or failed save. Inline errors and focused summary work by keyboard/screen reader. Reauthentication resumes only the same authorized live server draft, without PHI localStorage or restoration after authority loss.
28. Create a v2 patient-fillable request with no source/submission yet, save answers and run freeze. Before assignment, signing is unavailable. Race edits/cancellation/expiry and stale worker publication against freeze: only a current authorized result can bind source/submission and required round. Form-only explicit submission produces a durable unsigned copy; it never invents a signature or bypasses a required signing policy. Existing v1/frozen-signature behavior remains unchanged.

## Proposed Kanban implementation items

Use these as child tasks under the existing Forms/Documents workflow epic. All new implementation work below starts **To do** until actual work is evidenced. Existing implemented local foundations can remain **Done locally** with production activation tasks open. Design completion is not feature deployment.

| Task | Initial state | Priority and dependency | Completion evidence |
| --- | --- | --- | --- |
| Approve form and signing policy matrix | To do | P0; first | Categories, jurisdiction/authority/assurance, required signers and paper alternative approved |
| Extend visual builder in existing application styling | To do | P1; approved prototype | Guided/overlay modes, field properties, conditional/repeating fields, preview, publication checks and responsive accessibility |
| Add accessible collapsible staff navigation | To do | P1; current shell | Expanded/rail/focus modes, persistent per-user/device preference, unsaved draft and location context preserved |
| Add schema v2 publication and frozen patient submissions | To do | P0; policy matrix | Backward compatibility, immutable versions/translations, draft/freeze races and source provenance verified |
| Add required signer rounds and representative authority | To do | P0; schema v2 | All-required gate, role-bound sessions, fresh assurance, authority revocation and amendment checks |
| Add exact-version verification reports | To do | P0; immutable output | Integrity/identity/attestation/cert findings separated; stale and unavailable outcomes verified |
| Add governed form answer mappings and chart review | To do | P1; clinical model decisions | Approved bindings, reviewer permissions, destination revisions, source/decision audit |
| Add persistent authenticated paperwork library | To do | P0; patient binding/proxy policy | Exact released copies, explicit patient/proxy grants, revocation/minor/privacy scenarios verified |
| Add automatic secure-link paperwork notifications | To do | P0; library, provider and preferences | Completion-only outbox, current permissions, minimal content, independent delivery state |
| Select and activate email provider safely | To do | P0; provider/BAA decision | Approved contract, sender authentication, secrets, suppression/bounce/webhook controls; sandbox then controlled pilot |
| Activate durable workers and delivery reconciliation | To do | P0; existing operation/outbox foundation | Leases/fencing, crash recovery, unknown provider outcomes and deterministic resumption |
| Activate private versioned external object storage | To do | P0; storage/retention decision | Immutable version references, deny-overwrite grants, hold-aware reconciliation and tested restore |
| Activate production scanning and isolated rendering | To do | P0; provider/infrastructure | Fail-closed scanner, parser/renderer isolation, resource quotas, dependency gate |
| Extend audit catalog and independent archives | To do | P0; new domain contracts | New action/DB evidence coverage, denial/read audit, sealed archives, protected export tests |
| Implement approved retention and legal holds execution | To do | P0; approved policies | Classified anchor/hold behavior, no accidental purge, audited privileged disposition and restore drill |
| Complete cross-platform and production acceptance | To do | P0; all security prerequisites | Browser/accessibility/EN-ES scenarios plus physical iOS/Android and intended-environment release evidence |

A future certificate-based PDF-signature component is a separate scoped item only if the policy matrix requires it. The existing appended electronic signing record is not relabeled as certificate signing.

## Local design verification

This task produces design documents only. Verify their links, source baseline, lifecycle/endpoint/table consistency and status labels before handoff. Application tests, production security validation, live sends, hosted migrations and code changes are outside this task and remain unperformed.
