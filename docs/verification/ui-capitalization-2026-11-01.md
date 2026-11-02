# UI capitalization audit — November 1, 2026

> Superseded by the [November 2 every-word capitalization review](ui-capitalization-2026-11-02.md). This report preserves the initial-capitalization pass and its historical verification results.

The November 1 pass used sentence case for labels, headings, tabs, badges, and select options: capitalize the first word and retain acronyms. This local change updates 67 shared messages per language (134 catalog values), plus generated patient-signing labels and communications fallback labels.

## Local review checklist

| Screen | What changed / what to check |
| --- | --- |
| Today | Active visits today; Checked in; Need paperwork; Cancelled filter; visit status badges and Visit details status options. Select Cancelled and return to All visits to confirm filtering still works. |
| Appointments | Calendar and mobile agenda status labels, including Scheduled, Confirmed, Checked in, In progress, Completed, Cancelled, No show. |
| Patients | Readiness requirement states (Missing, Satisfied, Waived); document review badges; request states and delivery labels; activity outcomes. |
| Documents | Status filters; Accepted, Needs review, Replacement required, Archived; review options and version history. |
| Templates / Forms studio / workflow setup | Draft, Published, Retired, Active, Inactive and document/provider/requirement status badges and options. |
| Paperwork / patient pages | Request, item, submission and completed-copy states; generated signature-field labels, such as Patient signature. A closed request still reads naturally: “This request is cancelled.” |
| Communications / Notifications | Shared workflow labels and capitalized fallback reason/state labels when a named translation is unavailable; translated communications labels already used sentence case. |
| Sign in / Sign up | Or with email divider when social sign-in options are shown. |
| Spanish | Repeat the same screens in Español; labels now begin with capitals, including Citas activas hoy, Registrados, Necesitan documentos and Cancelada. |

The audit also covered practice/access settings, account owner controls, onboarding, audit views, personal account settings and legacy workspace components; their current headers, tabs and labels already use sentence case.

Authored form labels, patient/practice data, technical enum values, count/prose fragments, placeholders and the careiq wordmark keep their existing spelling. The closed-request sentence lowercases its interpolated status locally; badge labels stay capitalized.

## Verification

- Web unit checks: **128 passed**.
- Translation catalog checks: **7 passed**, including matching English/Spanish keys and named interpolation parameters.
- Web and shared translation type checks: **passed**.
- Focused local browser coverage: **95 unique cases passed** across `components.spec.ts` (34), `i18n.spec.ts` (8), `today-appointments.spec.ts` (11), `communications.spec.ts` (7), and `workflow.spec.ts` (35). This includes English/Spanish 320px layouts, document review, template publication, patient signing, scheduling commands and communication delivery.
- Browser checks used installed Chrome with `PLAYWRIGHT_CHANNEL=chrome` and isolated synthetic fixtures. The default bundled Chromium is absent locally. One initial navigation timeout passed on rerun. Existing status/signature expectations were updated to the corrected capitalization; the Published assertion now targets the selected template version.
- Catalog comparison against HEAD: all **134 changed values** differ only in their initial capital; message keys are identical. Existing browser command assertions verify canonical statuses, signature-field keys and submitted answers retain their original values.
- `git diff --check`: **passed**.

User acceptance remains pending local review using the checklist above. Work is local in `/Users/kristian/Documents/Server/CareIQ`.

Commands used with the repository’s Node 22.23.4 runtime:

```sh
pnpm --filter @careiq/i18n --filter web test
pnpm --filter @careiq/i18n --filter web typecheck
PLAYWRIGHT_CHANNEL=chrome pnpm --filter web exec playwright test --project=components tests/browser/today-appointments.spec.ts tests/browser/workflow.spec.ts tests/browser/i18n.spec.ts tests/browser/components.spec.ts tests/browser/communications.spec.ts --max-failures=3
PLAYWRIGHT_CHANNEL=chrome pnpm --filter web exec playwright test --project=components tests/browser/workflow.spec.ts tests/browser/communications.spec.ts --grep 'workflow.spec.ts|delivery detail keeps queued intent separate' --max-failures=2
PLAYWRIGHT_CHANNEL=chrome pnpm --filter web exec playwright test --project=components tests/browser/workflow.spec.ts --grep 'patient explicitly applies one signature'
```

## Full shared-message change list

The same keys serve multiple screens. Each row lists the exact old and new display text; stored identifiers and filter values do not change.

| Message key | English before → after | Spanish before → after |
| --- | --- | --- |
| `workflow.today.activeVisits` | active visits today → **Active visits today** | citas activas hoy → **Citas activas hoy** |
| `workflow.today.checkedIn` | checked in → **Checked in** | registrados → **Registrados** |
| `workflow.today.needsPaperwork` | need paperwork → **Need paperwork** | necesitan documentos → **Necesitan documentos** |
| `workflow.status.scheduled` | scheduled → **Scheduled** | programada → **Programada** |
| `workflow.status.confirmed` | confirmed → **Confirmed** | confirmada → **Confirmada** |
| `workflow.status.checked_in` | checked in → **Checked in** | registrada → **Registrada** |
| `workflow.status.in_progress` | in progress → **In progress** | en curso → **En curso** |
| `workflow.status.completed` | completed → **Completed** | completada → **Completada** |
| `workflow.status.cancelled` | cancelled → **Cancelled** | cancelada → **Cancelada** |
| `workflow.status.no_show` | no show → **No show** | ausencia → **Ausencia** |
| `workflow.status.ready` | ready → **Ready** | listo → **Listo** |
| `workflow.status.not_required` | not required → **Not required** | no requerido → **No requerido** |
| `workflow.status.needs_review` | needs review → **Needs review** | requiere revisión → **Requiere revisión** |
| `workflow.status.needs_attention` | needs attention → **Needs attention** | requiere atención → **Requiere atención** |
| `workflow.status.not_ready` | not ready → **Not ready** | pendiente → **Pendiente** |
| `workflow.status.incomplete` | incomplete → **Incomplete** | incompleto → **Incompleto** |
| `workflow.status.satisfied` | satisfied → **Satisfied** | cumplido → **Cumplido** |
| `workflow.status.waived` | waived → **Waived** | exento → **Exento** |
| `workflow.status.missing` | missing → **Missing** | falta → **Falta** |
| `workflow.status.available` | available → **Available** | disponible → **Disponible** |
| `workflow.status.processing` | processing → **Processing** | en procesamiento → **En procesamiento** |
| `workflow.status.quarantined` | quarantined → **Quarantined** | en cuarentena → **En cuarentena** |
| `workflow.status.rejected_scan` | safety check failed → **Safety check failed** | comprobación de seguridad fallida → **Comprobación de seguridad fallida** |
| `workflow.status.reserved` | reserved → **Reserved** | reservado → **Reservado** |
| `workflow.status.accepted` | accepted → **Accepted** | aceptado → **Aceptado** |
| `workflow.status.replacement_required` | replacement required → **Replacement required** | requiere reemplazo → **Requiere reemplazo** |
| `workflow.status.rejected` | rejected → **Rejected** | rechazado → **Rechazado** |
| `workflow.status.archived` | archived → **Archived** | archivado → **Archivado** |
| `workflow.status.draft` | draft → **Draft** | borrador → **Borrador** |
| `workflow.status.published` | published → **Published** | publicada → **Publicada** |
| `workflow.status.retired` | retired → **Retired** | retirado → **Retirado** |
| `workflow.status.active` | active → **Active** | activo → **Activo** |
| `workflow.status.inactive` | inactive → **Inactive** | inactivo → **Inactivo** |
| `workflow.status.open` | open → **Open** | abierta → **Abierta** |
| `workflow.status.pending` | pending → **Pending** | pendiente → **Pendiente** |
| `workflow.status.partially_completed` | partially completed → **Partially completed** | completada parcialmente → **Completada parcialmente** |
| `workflow.status.partially_fulfilled` | partially fulfilled → **Partially fulfilled** | cumplida parcialmente → **Cumplida parcialmente** |
| `workflow.status.delivered` | delivered → **Delivered** | entregada → **Entregada** |
| `workflow.status.failed` | failed → **Failed** | fallida → **Fallida** |
| `workflow.status.queued` | queued → **Queued** | en cola → **En cola** |
| `workflow.status.sent` | sent → **Sent** | enviada → **Enviada** |
| `workflow.status.bounced` | bounced → **Bounced** | devuelta → **Devuelta** |
| `workflow.status.complained` | reported as spam → **Reported as spam** | marcada como correo no deseado → **Marcada como correo no deseado** |
| `workflow.status.suppressed` | suppressed → **Suppressed** | suprimida → **Suprimida** |
| `workflow.status.succeeded` | succeeded → **Succeeded** | completada → **Completada** |
| `workflow.status.expired` | expired → **Expired** | vencida → **Vencida** |
| `workflow.status.declined` | declined → **Declined** | rechazada → **Rechazada** |
| `workflow.status.revoked` | revoked → **Revoked** | revocada → **Revocada** |
| `workflow.status.fulfilled` | fulfilled → **Fulfilled** | cumplida → **Cumplida** |
| `workflow.status.submitted` | submitted → **Submitted** | enviada → **Enviada** |
| `workflow.status.received` | received → **Received** | recibida → **Recibida** |
| `workflow.status.collection` | document collection → **Document collection** | recopilación de documentos → **Recopilación de documentos** |
| `workflow.status.signature` | signature request → **Signature request** | solicitud de firma → **Solicitud de firma** |
| `workflow.status.email` | email → **Email** | correo electrónico → **Correo electrónico** |
| `workflow.status.document_review` | document review → **Document review** | revisión de documentos → **Revisión de documentos** |
| `workflow.status.document_collection` | document collection → **Document collection** | recopilación de documentos → **Recopilación de documentos** |
| `workflow.status.missing_document` | missing document → **Missing document** | documento faltante → **Documento faltante** |
| `workflow.status.collect_document` | collect document → **Collect document** | recopilar documento → **Recopilar documento** |
| `workflow.status.request_follow_up` | request follow-up → **Request follow-up** | seguimiento de solicitud → **Seguimiento de solicitud** |
| `workflow.status.request_delivery_failed` | request delivery failed → **Request delivery failed** | entrega de solicitud fallida → **Entrega de solicitud fallida** |
| `workflow.status.scan_failure` | safety check failure → **Safety check failure** | fallo en la comprobación de seguridad → **Fallo en la comprobación de seguridad** |
| `workflow.status.replacement` | replacement → **Replacement** | reemplazo → **Reemplazo** |
| `workflow.status.reminder` | reminder → **Reminder** | recordatorio → **Recordatorio** |
| `workflow.status.unreviewed` | unreviewed → **Unreviewed** | sin revisar → **Sin revisar** |
| `workflow.status.disabled` | not configured → **Not configured** | sin configurar → **Sin configurar** |
| `workflow.status.denied` | denied → **Denied** | denegado → **Denegado** |
| `access.auth.orWithEmail` | or with email → **Or with email** | o con tu correo electrónico → **O con tu correo electrónico** |
