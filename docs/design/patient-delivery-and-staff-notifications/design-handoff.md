# CareIQ patient delivery and staff notification designs

October 18, 2026 · Implementation proposal · Responsive web and patient mobile web

Patient requests, reminders and completed-copy notices need a reliable path from a committed workflow event to a permitted recipient and a truthful delivery outcome. Staff need an inbox for assignments, changes in work ownership and overdue work, with actions that open the current authorized record. The designs share delivery infrastructure while preserving separate patient access, staff authorization and source-work status.

The [interactive prototype](prototype/index.html) contains ten primary views, request review and delivery dialogs, email/SMS previews, patient access and communication choices, staff alert detail, and recovery states. The synthetic clock is October 19, 2026 at 8:30 AM Pacific Time. The [backend design](backend-design.md), [proposed API](proposed-api.yaml), [screen inventory](screen-inventory.json), [source audit](workflow-audit.md) and [acceptance checklist](acceptance-checklist.md) complete the implementation handoff.

## Product boundaries

The first release supports transactional paperwork requests, reminders, explicit reissues and completed-copy availability notices. It does not introduce freeform clinical messaging or a two-way patient SMS inbox. Inbound SMS handles the provider's verified opt-out, opt-in and help workflow; unsupported replies receive an approved generic support response or follow-up route.

“Ownership change” means work ownership: assignment, reassignment and removal of an assignee. Practice ownership transfer remains a separate administrative security event. In-app staff notifications are the baseline; optional staff email follows personal preferences. Native push is a later adapter. This package draws responsive web and mobile web; native iOS/Android behavior is specified as adaptation guidance, rather than claimed as implemented native screens.

Current patient access is adult-self and location-bound. This feature preserves those eligibility gates. Proxy/minor support requires a separate reviewed authority and disclosure design. The proposed SMS completed-copy notice extends the current email-only paperwork schema; it must remain disabled until its permission, schema and worker changes are verified.

Four facts remain distinct throughout: source request/document/work status; communication intent; actual provider call and delivery evidence; individual notification read state. Neither delivery nor an email open proves reading, signing, review or completion. A failed notification never removes an authorized completed copy.

## Information architecture

In the production application, add a bell and unread count to the existing staff top bar. Its entry opens Notifications. Patient delivery is a work area under Documents or Communications; request-specific history also appears inside the existing request card. Reminder policies and staff routing belong in location settings. Personal preferences belong in the signed-in user's settings. Sender readiness belongs in manager settings, with detailed credentials and platform account configuration outside ordinary staff UI.

The prototype's sidebar is a design-review navigator containing every new surface. It is not a proposal to replace CareIQ's existing primary navigation.

| Surface | Required content and behavior |
| --- | --- |
| Patient delivery log | Location, snapshot, intent counts, status filters, patient/message search; patient, purpose, channel, masked destination, current delivery projection and latest update. One row per logical message/channel; attempts live in detail. |
| Request composer | Select an existing eligible request and bound recipient; show verified destinations and independent channel permission. Email, SMS or explicitly both; do not silently fall back. Use approved locale/template. Offer assisted completion if no channel is eligible. |
| Send review | Show exact patient/request context, intended audience, masked destinations, channel count, template version and preview. Queueing returns a durable operation/intent receipt. A repeated command reconciles the original result. |
| Manual reminder review | Existing request context, remaining obligation, current recipient, cooldown and delivery window. Reminder does not create a new paperwork request or silently reset expiry. Explain why a blocked reminder cannot send. |
| Delivery detail | Separate workflow state and communication state; intended versus actually used destination; real attempts, callback facts and timestamps; reason and follow-up owner. Queued/scheduled intent never invents an attempt. |
| Recovery | Unknown result: check original send. Permanent bounce: verify contact and suppress old destination. Opt-out: preserve suppression. Stale request: retain permitted draft and review current revision. Access loss: clear protected content. |
| Reminder policy | Explicit single location, enable switch, schedule slots, confirmed recipient zone, allowed delivery window, lifetime/cooldown limits, staff overdue follow-up and cancellation conditions. All-locations view is a read-only overview. |
| Message templates | Request, reminder and completed copy; email and SMS; approved version and locale. Proposed Spanish copy is marked for approval. Message locale cannot alter frozen document language. |
| Completed-copy status | Show Copy available independently from notice state. Expose current authorized exact version, notice outcome and repair/resend action with distinct permission. Never reopen a completed request to repair a notice. |
| Patient message and link | Minimal message; secure first-party link; explicit verification path; expired, revoked or unavailable safe failure; practice support. GET and scanner visits perform no mutation. |
| Patient library | After verified account/principal binding, fetch current exact-copy authorization. View/download the immutable released version; distinguish preparing, ready, restricted and superseded. |
| Patient communication choices | Independent request/reminder/copy purposes and channels, masked confirmed contact, current opt-out and alternative contact assistance. Permission is distinct from signing consent. |
| Staff inbox | All/unread/assignment/overdue views, owning location, current work state, event time, personal unread state and link to current work. Opening marks read without resolving work. |
| Staff detail | Event history alongside current owner/due/status. Explain resolved, reassigned or unavailable work. Open the existing source workflow; use its authorized commands to complete or reassign. |
| Personal preferences | In-app baseline; event-specific immediate email, digest or in-app only; confirmed staff zone, quiet hours and digest time. Generic external previews. |
| Staff routing | Initial assignment, reassignment, overdue threshold and finite escalation audience; current active membership and location/record permission; actor exclusion and deduplication. |
| Sender setup | Sender identity/domain or SMS sender readiness, callback health, test evidence, platform activation gate, pause control and safe operational metrics. No secret values in staff screens. |

The machine-readable inventory maps these surfaces to drawings, dialogs and specification-only requirements. Some production paths, including contact verification, exact-file streaming and revoked-session handling, are specified but deliberately simulated in the prototype.

## Patient journeys

### Request

1. Create or select the existing request through WorkflowWorkspace or FormsStudio. Server commands validate publication, patient/location, recipient and requested action. Assisted local review remains a separate channel.
2. Choose permitted destinations. Selecting both channels explicitly creates two intents, with independent outcomes. The send review explains the exact audience and purpose.
3. Commit the request/intent, business audit and outbox handoff together. Show Queued, Scheduled, Suppressed or a concrete error from the authoritative response.
4. Dispatch only after fresh eligibility checks. Generate or securely hand off a restricted request grant; a hash-only token cannot be reconstructed by a worker. Do not store raw bearer tokens in an ordinary outbox payload.
5. The message link opens a neutral first-party landing page. Verification and explicit session exchange use the existing restricted request path. Sign-in alone does not submit, sign or finish paperwork.

### Reminder

Automatic reminders are off until a manager enables them for one explicit location. Proposed starting slots are 48 and 24 hours before due time. The delivery window is 09:00–18:00 in the confirmed recipient IANA time zone. Missing zone or due time holds/skips the relevant automatic occurrence for review; there is no silent zone fallback. A deferral crossing the due time is skipped. Daylight-saving calculations resolve each occurrence once.

Allow at most two automatic reminders over the request's lifetime, including reissues, with at least 24 hours between automatic dispatches across channels. Manual reminders have a one-hour cooldown. Initial messages, reminders and resends share a proposed cap of three per request/destination in 24 hours; repeated scheduler ticks are not new messages. These numbers are product defaults requiring activation review.

Completion, cancellation, decline, expiry, replacement, removed authority, changed destination, suppression, cooldown and newer due generation all invalidate an obsolete occurrence. Stop patient reminders at due time and route current overdue work to staff. Recheck immediately before dispatch; a provider-accepted message cannot subsequently be recalled by changing preferences.

### Completed copy

Create the availability notice only after all required signer/finalization gates and durable exact-version publication. A form-only workflow uses “submitted copy” without claiming a signature. If finalization is still preparing, say the submission was received and prevent duplicate submission; do not send “ready.”

The completed-copy link requires the appropriate authenticated patient principal and current library grant. It is not a request bearer link. If notice delivery fails, keep the copy available and create eligible staff follow-up. Repairing an obsolete destination/grant preserves the same exact library version and eligible principal; a changed recipient is a new authority decision. Existing retry cannot silently adopt a newly bound identity. A superseded notice never silently redirects to a newer copy.

## Message design

Use a recognizable approved sender, one short purpose statement, one secure CTA and a practice support route. The practice name itself can reveal a relationship, so confidentiality choices still govern eligibility. Do not include patient names, diagnosis, form category, answers, signature, attachments, tracking pixels or third-party short links.

| Purpose | Email subject and main text | CTA | SMS main text |
| --- | --- | --- | --- |
| Request | “A secure request from Evergreen Medical.” “Please open your secure request to complete your paperwork.” | Open secure request | “Evergreen Medical: Please complete your paperwork using your secure request.” |
| Reminder | “A reminder from Evergreen Medical.” “Your secure paperwork request is still open. Please complete it when you can.” | Continue securely | “Evergreen Medical: A reminder to complete your paperwork using your secure request.” |
| Completed copy | “Your secure copy is ready.” “Sign in to view or download your completed copy.” | View secure copy | “Evergreen Medical: Your paperwork is ready. Sign in to view your secure copy.” |

The SMS adapter appends the approved STOP/HELP and rate wording for the supported region/sender. Do not assume every country uses the same legal footer or keywords. Render the exact approved body and compute segment count/encoding before dispatch. The prototype's English/Spanish bodies illustrate the design, rather than establish approved regulatory copy. Template review/version history must remain inspectable in production.

External staff notification: “You have a new work update. Sign in to CareIQ to review your work.” Digest emails use generic counts and one practice-scoped authenticated link. Patient details appear only after authorized app access.

## Staff journeys and event policy

| Committed change | Audience and behavior |
| --- | --- |
| Unassigned to owner | Notify the new eligible owner once. Self-assignment updates the source history without an interruptive self-alert. |
| Owner A to owner B | One ownership event; notify the new owner and the previous owner if still eligible, excluding the actor. Do not produce a duplicate “assignment” notice for the same recipient/transition. |
| Owner removed or becomes ineligible | Reconcile work to unassigned. Route attention to a configured authorized location queue or manager; preserve historical attribution. |
| Due time crossed | One alert for the current owner or explicit authorized unassigned fallback per due generation/threshold. Overdue is a property of active work, rather than an alternative completion state. |
| Still overdue | One escalation after the configured business interval. Proposed default: one business day, with an explicit Monday–Friday 09:00–17:00 location calendar and configured holidays. No repeated unchanged daily alert. |
| Patient delivery needs attention | Deduplicate by logical intent/problem episode; assign follow-up in the existing workflow. Suppression should not create an endless incident loop. |

At fan-out and external dispatch, recheck source state, membership, record/location access and current owner. Assignment and notification never grant access. Managers and practice owners need the same explicit relevant access. An empty eligible audience is a configuration exception; it never triggers practice-wide clinical notification.

Unread/read is recipient-specific and independent from source resolved/current state. Mark all read applies only to a server-issued authorized cutoff, so later arrivals stay unread. Group presentation for repeated changes to one source while retaining event history. Resolving or rescheduling source work suppresses obsolete deferred email. Proposed staff quiet hours are 18:00–08:00, with daily digest at 08:30 in the confirmed staff zone. In-app work remains visible during quiet hours.

## States and recovery language

| State | Meaning and next action |
| --- | --- |
| Scheduled / queued | No external call yet. Display intended destination and time, with eligibility pending. Cancel an unsent intent without cancelling its request. |
| Submitting | Leased worker has crossed or is crossing the dispatch boundary. Disable blind resend; show operation status. |
| Accepted | Provider acknowledged the send request. Delivery receipt remains pending. |
| Delivered | Verified provider-reported receipt. Do not mark patient read or request complete. |
| Unknown | External acceptance is uncertain. Check the original provider request with its stable key/reference; if unresolved, retain unknown and staff follow-up. |
| Retry waiting | A classified transient failure has a bounded next attempt time. Distinguish application retry from provider-managed retry. |
| Failed | Permanent rejection or exhausted allowed recovery; reason and follow-up visible. Preserve later provider facts. |
| Suppressed | Current rule prevents dispatch: opt-out, invalid contact, lost authority, request no longer actionable, limit or privacy restriction. Show the specific authorized reason. |
| Permission lost | Clear protected rows, counts, detail and drafts as required. Offer a permitted context or safe support route. |
| Temporary load failure | Give retry and currentness information; never render a failed query as an empty queue. |
| Stale revision | Retain the permitted draft alongside current authoritative data. Require review before retrying with the current precondition. |
| Obsolete staff alert | Preserve event history with the current resolved/reassigned state and a safe current-record action. |

The full backend state projection retains append-only callback facts, including delivery followed by bounce or complaint. “Needs attention” is a display grouping, not another provider receipt state.

## Components and responsive behavior

Reuse Signal Blue `#0067E8`, opaque white surfaces, CareIQ typography, padded menus and the current form/workflow component vocabulary. Blue identifies action/information, green confirmed success, amber waiting/attention and red failure/destructive action. Every state has a text label.

Shared components: scoped location picker, currentness timestamp, channel/destination display, status badge with reason, delivery activity timeline, message preview, send review dialog, blocked-action explanation, recipient-choice panel, inbox row, current-source summary and policy editor. Expose allowed actions from the server; the frontend does not derive authority from a badge or role name.

Desktop uses a compact table or inbox list and named details. Phone web stacks fields and rows while retaining purpose, channel, state and primary action. Dialogs fit the viewport, retain native focus containment/Escape and restore the opener. Policy tables may scroll within their own container, with explicit column relationships; primary patient actions must not require horizontal scrolling. Essential information cannot depend on hover. Use semantic labels, keyboard controls, text-plus-color status, inline errors, polite async announcements and approximately 44px primary touch targets.

Native adaptation should preserve these same contracts: iOS universal links/safe areas/dynamic type; Android app links/back stack/notification channels; generic lock-screen payloads; device-registration lifecycle; web fallback; denied OS-permission path. An OS dismissal does not mark a server notification read. Refresh permission before rendering protected foreground content.

## Integration and implementation order

1. Extend existing workflow/paperwork delivery schema, constraints and exact intent/attempt bindings. Define capability-gated activation. Add communication endpoints/permissions, safe token handoff, template versions and schedule occurrences. Preserve historical unconfigured attempts.
2. Implement the existing outbox/job foundation with current eligibility checks, leases/fencing, a stable provider request mapping and signed account-qualified callbacks. Unknown acceptance must reconcile before another external call.
3. Integrate WorkflowWorkspace request actions/cards, FormsStudio send choice, StaffPaperwork notice state and PatientWorkflow/PatientPaperworkLibrary destinations. Add delivery log/details and governed configuration.
4. Emit committed work-ownership events; add recipient inbox/receipts, current-source resolver, due generations, finite escalation and optional staff email/digest preferences.
5. Verify actual runtime-role tenant/location/patient authorization; crash, retry and callback order cases; opt-out races; current-grant repair; accessible web flows; approved provider synthetic tests and operational pause/recovery. Then activate a restricted allowlist and review evidence before expanding.

Canonical integration points and exact source references are in the backend design and workflow audit. No application, database, provider, deployment, external patient delivery or staff notification is activated by the prototype.

## Verification scope

`verification.json` records browser interactions and layout checks at 1440, 1024, 768, 390 and 320px, plus recovery states, patient states, channel queueing, duplicate prevention, original-send reconciliation, scope filtering, read-only details, read versus work status, explicit location policy editing, saved local preferences and dialog focus. Screenshots are in `screens/`.

These checks validate the local design reference. Server authorization, provider behavior, exact-file access, native devices, migrations and full assistive-technology compliance require implementation acceptance from the separate checklist.
