# CareIQ Forms Studio — second design and contract pass

Review date: October 17, 2026. Scope: design artifacts and handoff only. Canonical application files and synced `sources/` were read-only. This review is not production security validation or a legal assurance opinion.

## Findings and corrections

| Priority | Evidence before this pass | Resolution |
| --- | --- | --- |
| P1 design consistency | The fragment's `patientContent()` and `view-patient-pdf` action interpolated the mutable builder `version` into a retained signed-copy record. Creating a later template draft therefore changed the displayed version of old paperwork. | UI owner is pinning an immutable completed-record snapshot; existing sample copies stay on v3 and a simulated new completion captures its assigned version. This is a design correction; immutable application records already remain required by the architecture. |
| P1 API lifecycle | `api-contract-design.md`, Staff patient workflow endpoints and the frozen-signature creation example required source/submission IDs before request creation, while patient answer/freeze routes required an existing request. The pre-signing draft stage was not specified. | Added a proposed v2 `form_completion` purpose bound to one exact published template and scoped prepared draft. Draft-purpose grants can exist before a round and cannot sign; verified freeze atomically binds source/submission and creates required signing work under request/revision/fencing checks. Existing v1 and frozen-signature mode retain their semantics. Form-only submission produces an unsigned copy. |
| P1 data integrity | Conditional logic validation and frozen applicability were present, but none of the three contracts defined whether a formerly visible value could leak into rendering or chart candidates after its branch became hidden. | Inactive values are excluded from the active submitted answer set, PDF and mappings. Protected draft history remains separately retained. Reactivation requires confirmation. Repeats use stable item IDs and published count/depth/size limits. |
| P2 patient completion | Restricted PATCH/save routes and session expiry existed, but save-status confirmation, interrupted saves, error focus and safe draft resume were not explicit. The sample UI claimed progress was saved without server persistence. | Added server-revision-confirmed Saved, pending/failed/offline states, inline errors and focused summary, freeze/sign gates and fresh same-request authority to resume a server draft. No PHI localStorage or revoked-session revival. The prototype now needs truthful local-preview wording, owned by the UI agent. |
| P2 status accuracy | `signing()` promised retries without duplicate notices. The audit example labeled provider acceptance as delivery and authenticated byte access as patient viewing. | UI owner is replacing these labels with tracked/reconciled retry wording, provider acceptance and observed app access. The architecture already separates these facts and does not promise exactly-once email or proof that a patient read a PDF. |
| P2 styling/accessibility | Product variables followed the host's dark theme; native option menus did not match the current approved padded dropdown panels. | UI owner is forcing the requested white product theme and matching the current app's white padded menus, blue focus/selection and checkmarks. Open-menu keyboard/focus, mobile and dark-host appearance need visual verification in the current pass. |

## Confirmed already covered

- Exact frozen source, answer, consent, locale, role and assigned-presentation binding; immutable published versions and successor amendments. See architecture Signing and authority, State and version rules and Durable completion protocol; API Patient signature acknowledgement.
- Required provider countersignature, alternative representative authority, decline/expiry/revocation and no signature reuse on changed substantive content. Authority and account access remain distinct from signature marks.
- Atomic last-required-signer acknowledgement, completion operation/outbox handoff, fenced durable object finalization and library/notification publication. Email failure cannot erase a completed in-app copy.
- Purpose-scoped patient/proxy library access, current recipient preferences, minimal secure-link email, verified webhooks, ambiguous-send reconciliation and no default PDF attachments.
- Governed mapping registry, reviewer authority, destination revisions, immutable source answers and append-only decisions; patient signature alone cannot approve a chart update.
- Tenant/location/patient isolation, RLS runtime-role limitations, scoped FKs, scanner/renderer isolation, protected read/denial audit, independent archives, retention/holds and DB/object restore. These remain design/activation requirements where not implemented locally.

## Exact local change ledger for Notion synchronization

The machine-readable ledger at `architecture-changes.json` preserves every exact old/new changed block against the original handoff ZIP. It contains 16 blocks including independent-review amendments. Update existing Notion child specs with these targeted changes; do not replace parent pages or their children.

`architecture-and-data-model.md`:

- Changed existing `template_versions` table cell to include published `form_only/form_then_sign` completion policy and conditional signer-policy reference.
- Added `document_requests`, `document_request_items` v2-extension table row.
- Added new heading **Conditional answers and interrupted completion** after the existing JSONB/clinical-model paragraph, with two paragraphs.
- Added new heading **Patient form request before signing**, with two paragraphs immediately before the existing outside-document/OCR paragraph.
- Changed existing `patient_access_grants`, `patient_sessions` table cell to state purpose-checked references and non-wildcard null-round handling.
- Added `REQUEST_ITEM ||--o| PREPARED_DOCUMENT : assigns_draft` to Main relationships.
- Added **Form-completion phase (v2 projection)** to State and version rules.
- Qualified the prepared-answer lifecycle so a successor needs a new signing round only when signing is required.

`api-contract-design.md`:

- Changed the staff `POST /patients/{id}/document-requests` table cell for both frozen-signature and pre-signing form-completion modes.
- Changed restricted session exchange, request DTO, PATCH answers, POST freeze and operation-polling table cells; added two explanatory paragraphs after the existing one-hour cookie paragraph. Pre-round polling is bound to the exact request/item/draft; a null round cannot widen access.
- Added **Start a patient-fillable form before a source PDF exists** before Publish a validated template.
- Qualified `FORM_ALREADY_FROZEN` local edit retention as authorized page memory only; added `DRAFT_NOT_READY`.

`security-audit-and-delivery-plan.md`:

- Added three threat rows after Auto-mapping overwrites clinical facts: inactive conditional answers, interrupted saves and premature signing of a draft.
- Added acceptance criteria 26–28 for those same three cases. Existing 1–25 remain intact.

## Short Notion appendix

The second design pass corrects the white palette and current padded dropdown panels, preserves the displayed version of completed copies when a newer template draft is created, and separates email-service acceptance from delivery and observed application access from proof of reading.

The handoff now specifies the missing pre-signing form-completion stage: a request pins an exact template and scoped patient draft before a source PDF exists. Verified freeze binds immutable answers/source and required signing work under revision, authorization and worker-fencing checks. Forms without a signature policy produce an unsigned submitted copy. Existing v1 and frozen-signature requests keep their semantics; this is proposed schema/API work.

Conditional answers that become hidden cannot enter submitted content or chart candidates. Repeating items use stable IDs, and restored branches require confirmation. Patient save status requires an accepted server revision; pending/failed saves block freeze/signing. Interrupted sessions resume only the same authorized live server draft after fresh access, with no PHI persistent browser cache. Three additional threat cases and acceptance criteria cover these rules. Implementation tasks remain open; no application code or live email/provider configuration changed.

## Verification

All eight existing API JSON examples parse after these edits. A separate reviewer found the revised lifecycle coherent, then identified two additional wording inconsistencies: pre-round operation polling and no-signature successor lifecycle. Both were corrected, along with the purpose-specific request DTO. UI and Notion readback verification are reported separately by the root task; this file does not claim those checks were executed by this reviewer.
