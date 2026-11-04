# CareIQ Forms API Contract Design

Design proposal · October 17, 2026 · No endpoints implemented by this design artifact

Extend the canonical local workflow API rather than creating a parallel forms backend. Existing staff routes use `S = /api/v1/locations/{locationId}/workflow`. Existing restricted patient routes use `P = /api/v1/patient-workflows`. Proposed persistent patient-library routes use `A = /api/v1/patient-portal`, with a separate authenticated principal and explicit patient/document authorization.

Existing endpoint status below refers to the [canonical local runtime contract](/Users/kristian/Documents/Server/CareIQ/docs/design/workflow/runtime-contract.md), not hosted activation. The design adds schema-v2 capabilities behind an explicit feature gate and client capability negotiation; existing one-signer v1 requests preserve their semantics.

## Common contract

Success uses `{data: ...}`. Errors use `{error:{code,message,requestId,details?}}`, with bounded safe field-level details. No tokens, addresses, raw answers, signature values, internal storage paths or foreign-resource facts appear in errors. Collections use signed cursor pagination bound to actor, scope, filters and limit. Counts and lists share a consistent read snapshot.

All POST/PATCH domain commands require `Idempotency-Key`, a UUIDv4. Mutable commands also require `If-Match: "{revision}"` or an explicitly documented aggregate revision in the body. The idempotency fingerprint includes actor/session, practice/location, method, canonical target, normalized payload, original preconditions and schema version. A different fingerprint with the same key conflicts. Before replay, recheck current authorization; replay yields a safe original receipt or the same operation, never an expired bearer URL or PHI after access loss. A durable business key prevents duplicate signing/finalization even after transport-key expiry.

Authentication/session exchange and provider webhook ingestion use their own one-time-token/event replay safeguards rather than the clinical command Idempotency-Key requirement. Unique-object binary PUTs are independently authorized and bounded to the upload session.

The server generates request IDs. `allowedActions` and capabilities guide the interface but confer no authority. Staff commands validate current Clerk permissions, local enrollment, location assignment, patient agreement and resource state inside the transaction. Patient sessions cannot pass arbitrary patient IDs or choose another signer. Portal operations resolve patients through explicit current grants rather than email matching. Jobs and webhooks cannot bypass these scope rules.

Use no-store/no-referrer on protected pages and content. Cookie-authenticated writes check CSRF/allowed origin. Responses use the approved first-party origin and reject arbitrary redirect destinations. Binary content is authorized again before headers and streamed with an exact object/version audit grant. Do not put a form token or patient identifier in query strings, third-party analytics, crash reports or link tracking.

## Staff authoring endpoints

| Method and path under S | Status | Permission and behavior |
| --- | --- | --- |
| `GET /templates` and `/templates/{id}` | Existing local | `org:workflow:configure`; template metadata/content, current draft and immutable published version. Patient-free configuration only. |
| `POST /templates` | Extend | Existing configure permission; create guided or PDF-overlay template. `schemaVersion:2` required for new layout/signing policy. |
| `PATCH /templates/{id}` | Existing local | Rename or deactivate under template revision. Published content unchanged. |
| `POST /templates/{id}/versions` | Extend | New draft from exact base version; record source lineage and expected template revision. |
| `PATCH /template-versions/{id}` | Extend | Draft-only structured content/layout/field/locale/signing rules. Reject unknown executable markup and arbitrary mapping destinations. |
| `POST /template-versions/{id}/validation-runs` | New | Validate exact draft revision and bounded rules; return results tied to hash. No PHI in validation fixture. |
| `POST /template-versions/{id}/previews` | New | Render synthetic fixture for selected form/document language and viewport; asynchronous operation with private preview object. Preview is visibly watermarked and cannot fulfill a patient requirement. |
| `POST /templates/{id}/publication` | Extend | Requires passing checks for this exact draft revision, approved legal language and signer policy. Atomically publish immutable content and pointer. |
| `POST /template-assets/upload-sessions` | New | Configure permission; upload only to practice asset quarantine. No patient records accepted as reusable template assets. |
| `PUT /template-assets/upload-sessions/{id}/content` | New | Reauthorize upload and bound bytes/type; unique object only. |
| `POST /template-assets/upload-sessions/{id}/completion` | New | Verify/scan/sandbox; return 202. Unsafe/unavailable scan never becomes usable. |
| `POST /template-versions/{id}/translations` | New | Create a translated draft; legal/document locale independent of interface locale. |
| `POST /template-versions/{id}/field-bindings` | New | Governed mapping draft; use registered destination operation. Clinical mapping approval is separate from layout authoring. |

`org:workflow:configure` is the current template/configuration permission. Separate proposed permissions such as `org:forms:publish` and `org:forms:mappings:approve` require a reviewed Clerk configuration/release change; until active, reject operations needing unavailable authority rather than infer it from practice ownership.

## Staff patient workflow endpoints

| Method and path under S | Status | Permission and behavior |
| --- | --- | --- |
| `POST /patients/{id}/prepared-documents` | Extend | Authorize patient and documents workflow; exact template version and prefill selection. Returns prepared draft/submission and operation identifiers. |
| `PATCH /prepared-documents/{id}/answers` | New | Authorized draft only, If-Match; validate against pinned schema. Do not mutate frozen answers. |
| `POST /prepared-documents/{id}/freeze` | New | Validate all required visible fields, evaluate frozen conditions and render exact source; returns 202 operation. |
| `POST /patients/{id}/document-requests` | Extend | `org:requests:send` plus document access. Frozen `signature` mode includes exact submission/source, signer-policy version and intended signer roles. Proposed v2 `form_completion` mode instead pins one prepared draft/template and derives form-only versus signing policy server-side; no signing round until verified freeze. Existing v1 one-item behavior preserved. |
| `GET /requests/{id}` | Extend | Return request, independent signer/completion/review/delivery facts and permitted actions. No raw signing secrets. |
| `POST /requests/{id}/reminders` or `/reissue` | Extend | Fresh send permission, revision, cooldown, current recipient preference. Reissue revokes prior live grants/sessions; signed acknowledgement cannot move to a new source. |
| `POST /requests/{id}/cancellation` | Existing local | Reasoned revision-checked cancellation; serializes against finalization. A completed result requires amendment/void workflow. |
| `POST /signature-packets/{id}/rounds` | New | New immutable signing round after authorized content/recipient/policy change; old round invalidation and reason recorded atomically. |
| `POST /signature-packets/{id}/signers/{signerId}/verification-review` | New | Explicit authorized manual identity/authority review, evidence reference and reason. Cannot self-assert a higher assurance label without required proof. |
| `GET /document-versions/{id}/content?purpose=` | Existing local | `org:documents:read`; proxy exact bytes after current access and integrity checks. View/download/print are intended purposes, not proof of human action. |
| `POST /document-versions/{id}/verification-runs` | New | Authorized fresh integrity/evidence/trust check; 202 operation. Cannot silently overwrite prior reports. |
| `GET /document-versions/{id}/verification` | New | Latest and historical run references, current standing and independent findings, stale/current status. Sensitive evidence filtered by permission. |
| `POST /documents/{id}/amendments` | New | Authorized reasoned successor; retain completed original and require new signatures as applicable. |
| `GET /form-submissions/{id}/change-candidates` | New | Appropriate demographic/clinical review permission; return source, destination revision and protected proposed changes. |
| `POST /form-change-candidates/{id}/decisions` | New | Appropriate domain update authority; explicit decision and destination If-Match. Atomic decision/audit/domain change. |
| `POST /document-versions/{id}/patient-release` | New | Explicit release permission and audience policy; signed patient paperwork can use automatic completion policy. No release of arbitrary staff evidence. |
| `POST /paperwork-notifications/{id}/resend` | New | Send permission, current verified destination/preference, cooldown and reason. New attempt; same exact completed version. |
| `GET /operations/{id}` | Extend existing local | Safe current state for authorized aggregate; never disclose another patient's operation or a filesystem/provider secret. |

New clinical permissions must be reviewed with the current role matrix; template-author access alone cannot read patient answers, approve chart changes, send requests or view signed documents.

## Restricted completion endpoints

| Method and path under P | Status | Behavior |
| --- | --- | --- |
| `POST /session-exchanges` | Existing local, extend | Exchange hash-only one-time grant into Secure HttpOnly SameSite session. `complete_form` binds request/item/draft and intended respondent without a round; signing requires exact round/signer. A missing round never grants wildcard access. Reject invalid links generically and rate-limit without disclosing patient existence. |
| `GET /request` | Extend | Exact request, selected document language, entitled draft schema/answers, completion phase and permitted actions. Signing-purpose responses add signer role, required assurance and assigned presentation version/hash only when available; no fabricated round/presentation while answering. No other patient history. |
| `POST /verification-challenges` | New | Start approved assurance method; bounded resend/challenge rate. An email challenge is labeled channel possession, never an independent second factor. |
| `POST /verification-challenges/{id}/responses` | New | Verify current challenge bound to same session/signer/round; one-use, expiry and failed-attempt limits. No raw verifier secrets retained. |
| `PATCH /answers` | New | Same form-completion request's mutable draft only, If-Match. Return the accepted draft revision and safe field validation state. Re-evaluate server-side applicability; inactive answers cannot enter submitted content or mappings. Saving does not claim completion. |
| `POST /freeze` | New | Require the latest accepted draft revision and explicit submission intent where the policy calls for final form-only submission; 202 durable freeze/render operation. The server derives active answers, requirements and source. Verified completion binds submission/source and any required packet/round atomically after request/revision/fencing checks. Client cannot choose a lower-assurance or no-signature policy. |
| `GET /document` | Existing local, extend | Exact immutable presentation version assigned to this signer/round, with scoped authorization and integrity checks. Return assignment/version/hash metadata with the request DTO, not an arbitrary selectable version. A sequential presentation is unavailable until its verified render/assignment commits. |
| `POST /consent-acceptances` | New | Record separate exact notice/consent version acknowledgement. Optional communication preference is independent of signing intent. |
| `POST /completion` | Extend | Existing v1 remains. V2 acknowledges exact round, submission, source and signing intent plus assigned fields and current verification. All-required-signer gate drives finalization. |
| `GET /operations/{id}` | New | `complete_form` may poll only operations for its exact request/item/prepared draft; `sign_document` requires the exact request/round/signer. No null-round wildcard or arbitrary operation lookup. Surviving same-session terminal retries expose a receipt only, with no widening of document access. |
| `GET /completed-document` | New | Exact completed copy through purpose-scoped live permission or authenticated portal grant. No arbitrary version argument. |
| `POST /decline` | Existing local, extend | Record bounded optional reason; never satisfy signature requirement. Staff/paper alternative shown. |

Keep the existing one-hour maximum restricted cookie and request-grant bound expiry unless a separately reviewed session policy changes it. Do not automatically revive a revoked session for a convenient retry. A safe terminal receipt is not a persistent file-access grant.

`PATCH /answers` preserves stable repeat-item IDs and enforces published item/depth/size limits. A hidden/inapplicable value is excluded from active submitted answers, rendering and change candidates; prior draft history remains protected and must be re-confirmed if the branch is shown again. The freeze receipt identifies the accepted draft revision and exact immutable submission/source when ready. Do not permit a signature acknowledgement against a draft or a still-rendering source.

The interface announces a save only after that revision is accepted. Pending/offline/failed saves block freeze or signing and show inline errors plus a focused summary where validation fails. After session expiry, reauthorize the same live request before returning its server draft; never revive a consumed/revoked grant or place answers in persistent browser storage for convenience. Authority loss clears protected client data; ordinary save errors preserve the in-memory draft while the authorized session remains live.

## Patient library and preferences

| Method and path under A | Status | Behavior |
| --- | --- | --- |
| `GET /paperwork` | New | Authenticated portal principal; cursor-scoped released items accessible through current explicit patient/proxy grant. No email-based discovery. |
| `GET /paperwork/{libraryItemId}` | New | Exact immutable copy metadata, document language, completed date, amendment/standing and allowed actions. |
| `GET /paperwork/{libraryItemId}/content?purpose=` | New | Recheck current account, grant, audience/release and exact version; stream bytes with audit. |
| `GET /paperwork/{libraryItemId}/signing-record` | New | Patient-readable evidence summary and required signer roles; no raw forensic IP/device/security data. |
| `GET /communication-preferences` | New | Current permitted preferences and verification state for authenticated person/representation. |
| `POST /communication-preference-events` | New | Explicit purpose/channel/locale choice; separate address verification workflow; withdrawal appends event and suppresses pending eligible notifications. |
| `POST /electronic-record-consent-withdrawals` | New | Record prospective withdrawal, effective processing and available paper/assisted option; retains previous completed documents and historical consent. |

Notification links route to `https://{approved-app-origin}/paperwork/{opaqueNoticeId}`. Treat the identifier as a navigation reference only. Authenticate, then resolve its exact library item under current authorization; never use an arbitrary `returnTo` value from the link. Forwarding the email must not disclose paperwork to an unauthenticated recipient.

## Representative contract examples

The examples use synthetic identifiers and addresses. They specify intended v2 behavior, not working commands against the current app.

### Start a patient-fillable form before a source PDF exists

Proposed `POST S/patients/{patientId}/document-requests` with `contractVersion:2`, `purpose:"form_completion"` and a single item containing `requirementId`, `preparedDocumentId` and `templateVersionId` creates an open request at `completionPhase:"awaiting_answers"`. The server validates the draft belongs to that patient/item and derives `completionPolicy:"form_only"` or `"form_then_sign"` from the published version; the client cannot remove a required signature. Source/submission/round IDs are absent while answering. This requires an explicit reviewed purpose-enum/schema extension and v2 feature/client gate; the current local purpose enum remains unchanged by this document.

`POST P/freeze` identifies the accepted answer revision. Its verified result is attached under request/item/draft locks and worker fencing; that transaction binds exact source/submission and, for signing, creates the packet/round/presentation work. Signing stays unavailable until assignment is durable. `form_only` completion records an unsigned submitted copy after explicit submission and verified output, with no signer count or signed claim. Both modes retain current access checks, audit and durable library/notification publication.

### Publish a validated template

`POST S/templates/{templateId}/publication`

Headers: `Idempotency-Key: 5f14872e-c4de-4d0a-ae25-fb035b750c66`, `If-Match: "12"`.

```json
{
  "versionId": "019a1b11-1111-7111-8111-111111111111",
  "schemaVersion": 2,
  "expectedDraftRevision": 7,
  "validationRunId": "019a1b11-1111-7111-8111-111111111112",
  "signingPolicyVersionId": "019a1b11-1111-7111-8111-111111111113",
  "documentLocales": ["en-US", "es-US"]
}
```

```json
{
  "data": {
    "templateId": "019a1b11-1111-7111-8111-111111111114",
    "publishedVersionId": "019a1b11-1111-7111-8111-111111111111",
    "versionNumber": 4,
    "revision": 13,
    "state": "published",
    "existingRequestsChanged": false
  }
}
```

Stale draft/validation results return `412 STALE_REVISION` or `409 PUBLICATION_CHECK_OUTDATED`. Field/schema errors return 422 with field keys and safe reasons. A missing required approved locale or signer policy blocks publication.

### Create a request with patient and provider signers

`POST S/patients/{patientId}/document-requests` requires the existing send/document authorities plus v2 feature capability.

```json
{
  "contractVersion": 2,
  "purpose": "signature",
  "items": [{
    "requirementId": "019a1b22-2222-7222-8222-222222222221",
    "sourceDocumentVersionId": "019a1b22-2222-7222-8222-222222222222",
    "submissionId": "019a1b22-2222-7222-8222-222222222223"
  }],
  "signingPolicyVersionId": "019a1b22-2222-7222-8222-222222222224",
  "signers": [
    {"roleKey": "patient", "recipientRef": "verified-contact-ref", "documentLocale": "en-US"},
    {"roleKey": "provider", "staffUserId": "synthetic-provider-user"}
  ],
  "expiresAt": "2026-10-24T17:00:00-07:00",
  "delivery": {"sendNow": true},
  "completedCopy": {"publishToPatient": true, "notifyByEmail": "when_permitted"}
}
```

The client chooses eligible intended parties; the server derives required roles, assurance, conditional fields, acceptable recipient methods and policy. It never trusts `required:false` or a lower minimum assurance supplied by the browser. Provider identity must have required current authority in this location.

```json
{
  "data": {
    "requestId": "019a1b22-2222-7222-8222-222222222225",
    "roundId": "019a1b22-2222-7222-8222-222222222226",
    "state": "open",
    "signingState": "pending",
    "requiredSignerCount": 2,
    "acknowledgedSignerCount": 0,
    "delivery": {"dispatchState": "queued", "deliveryOutcome": "unconfirmed"},
    "completedCopy": {"state": "not_ready", "notificationState": "pending_completion"}
  }
}
```

If the email provider is unconfigured, the response reports `unavailable`/`DELIVERY_PROVIDER_UNAVAILABLE` and no sent claim. The signature request may remain open for supported assisted completion. Production APIs do not return a raw signing token to ordinary staff logs or retry storage.

### Patient signature acknowledgement

`POST P/completion` authenticates only the bound signer session and requires Idempotency-Key.

```json
{
  "contractVersion": 2,
  "expectedRevision": 6,
  "roundId": "019a1b22-2222-7222-8222-222222222226",
  "sourceSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "submissionSha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "presentationVersionId": "019a1b22-2222-7222-8222-222222222227",
  "presentationSha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "consent": {"accepted": true, "textVersion": "esign-en-US-v3"},
  "intent": "sign_this_document",
  "fields": [{"key": "patient_signature", "type": "typed_signature", "value": "Avery Example"}]
}
```

The server selects the signer from session context, checks source/answer/consent hashes, the exact assigned presentation version/hash and fresh minimum assurance, and assigns the timestamp. It rejects unexpected signer IDs, other signers' fields, unknown field keys and changed answer content. Client evidence cannot override server facts. A different presentation cannot reuse an earlier acknowledgement; any required next-signer presentation operation/outbox handoff commits atomically with the prior acknowledgement.

```json
{
  "data": {
    "signatureReceiptId": "019a1b33-3333-7333-8333-333333333331",
    "signerState": "acknowledged",
    "packetState": "pending",
    "requiredSignerCount": 2,
    "acknowledgedSignerCount": 1,
    "messageCode": "AWAITING_REQUIRED_SIGNER",
    "staffReviewState": "not_ready",
    "paperworkCopyState": "not_ready"
  }
}
```

When the last required signer acknowledges, the acknowledgement, all-required gate, pending-to-completing transition, unique finalization operation, outbox handoff and audit commit atomically under shared locks. Return 202 with `packetState:"completing"` and a restricted operation reference. Only after durable output/evidence and final commit does the operation return `completed` and the exact library item. No early email is queued because a signature gesture was captured.

### Exact completed copy and email state

`GET A/paperwork/{libraryItemId}` after completion:

```json
{
  "data": {
    "id": "019a1b44-4444-7444-8444-444444444441",
    "documentVersionId": "019a1b44-4444-7444-8444-444444444442",
    "title": "Completed paperwork",
    "documentLocale": "en-US",
    "completedAt": "2026-10-17T19:42:08Z",
    "standing": "current",
    "signing": {"state": "completed", "required": 2, "acknowledged": 2},
    "verification": {"integrity": "matches", "pdfCertificateSignature": "not_present", "verifiedAt": "2026-10-17T19:42:09Z", "freshness": "current"},
    "notification": {"dispatchState": "accepted", "deliveryOutcome": "unconfirmed"},
    "allowedActions": ["view", "download", "view_signing_record"]
  }
}
```

Do not expose provider addresses/message IDs or forensic evidence in the patient DTO. The exact version is unchanged if staff later uploads a replacement; show the amendment/supersession relationship and retain the accessible original according to policy.

### Verification result

```json
{
  "data": {
    "documentVersionId": "019a1b44-4444-7444-8444-444444444442",
    "runId": "019a1b55-5555-7555-8555-555555555551",
    "verifiedAt": "2026-10-17T19:42:09Z",
    "policyVersion": "verification-v1",
    "freshness": "current",
    "integrity": {"source": "matches", "signerPresentations": "matches", "output": "matches", "evidence": "matches"},
    "requiredSigners": "complete",
    "identityEvidence": [{"role": "patient", "method": "authenticated_account", "policySatisfied": true}],
    "careiqAttestation": "missing",
    "pdfCertificateSignature": "not_present",
    "standing": "current",
    "legalValidity": "not_determined"
  }
}
```

`policySatisfied:true` means only the named configured technical policy was met. A missing/unimplemented CareIQ attestation or PDF certificate signature is displayed truthfully. Stale prior success cannot override a current failed check. The API never returns a general legal-validity assurance.

## Delivery integration and webhooks

The selected provider adapter exposes `submit`, `lookup`, `normalizeEvent` and `verifyWebhook`; it maps to an approved sender/account and never accepts arbitrary customer credentials in a form command. Provider-side idempotency uses the stable notification/attempt identity. A timeout after possible provider acceptance becomes `unknown`; reconcile before repeating. Retrying a job is distinct from making a new actual send attempt.

`POST /api/v1/delivery-webhooks/{provider}` is signature-authenticated, independently rate/size limited and exempt only from user session authentication. Verify raw body/timestamp, deduplicate the provider event, resolve provider account/message to an existing attempt, then apply an explicit event transition. Never accept an event's practice/patient ID as authority. Unknown event mapping is retained safely for reconciliation. A provider can report delivered followed later by bounce/complaint; preserve both events and suppress future eligible attempts. Late callbacks do not reopen cancelled requests or create completed documents.

No live email, SMS, webhook configuration, provider subscription or patient notification is sent as part of this design task.

## Error and race handling

| HTTP and code | Behavior |
| --- | --- |
| 400 `INVALID_REQUEST` | Bounded syntax/header issue; never echo input secrets |
| 401 `AUTHENTICATION_REQUIRED` | Missing/expired staff or portal session; restricted invalid link response remains generic |
| 403 `ACTION_NOT_ALLOWED` | Verified context but missing action permission; do not expose foreign-resource details |
| 404 `RESOURCE_NOT_FOUND` | Missing or inaccessible resource indistinguishable where needed to prevent enumeration |
| 409 `IDEMPOTENCY_CONFLICT` | Same key, different command/target/precondition; no side effect |
| 409 `FORM_ALREADY_FROZEN` | Authorized live page may retain unsaved edits in memory for an explicit successor workflow; never persistent browser storage or an overwrite of the signed source. Clear on sign-out, expiry or authority loss. |
| 409 `SOURCE_CHANGED` or `ROUND_INVALIDATED` | Refresh exact current authorized state; new acknowledgement required |
| 409 `COMPLETION_ALREADY_FINAL` | Cancellation cannot erase completed output; provide authorized amendment action |
| 409 `DRAFT_NOT_READY` | Freeze/signing attempted before the accepted revision or verified frozen presentation is ready; return the current authorized operation/phase |
| 410 `WORKFLOW_LINK_UNAVAILABLE` | Expired/revoked unavailable link, with nonidentifying assistance path |
| 412 `STALE_REVISION` | Preserve user input, show conflict and require explicit resolution; no silent last-write-wins |
| 422 `FORM_VALIDATION_FAILED` | Field keys and safe validation reasons; conditional rules re-evaluated server-side |
| 422 `SIGNER_POLICY_UNSATISFIED` | Missing required signature/authority/assurance; no downgrade |
| 429 `RATE_LIMITED` | Bounded Retry-After; do not reveal whether a contact is enrolled |
| 503 `AUDIT_UNAVAILABLE` | Block protected mutation/read release when mandatory audit cannot persist |
| 503 `VERIFICATION_UNAVAILABLE` | Required assurance not established; supported alternate completion path |
| 202 `PROCESSING` | Same durable operation and safe poll path; not completed, signed-copy-ready or emailed |

Use ordinary authorization failures before revealing validation details for an inaccessible record. An integrity mismatch blocks content release/finalization and raises a protected incident; never fall back to an unverified regenerated PDF.
