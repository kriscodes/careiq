# CareIQ notifications — workflow and design audit

Prepared October 18, 2026. Read-only inspection of local application and prior design artifacts. This file proposes implementation designs; it does not assert working provider delivery, a deployed notification center or native app screens.

**Canonical application:** `/Users/kristian/Documents/Server/CareIQ`. Its actual current workflow is more complete than the older `careiq-practice-mobile` project mirror. The canonical rows below supersede mirror-only gap observations. This design task writes deliverables into the current workspace; neither application checkout was edited.

## Existing evidence and useful attachment points

| Evidence | Observed state | Design implication |
| --- | --- | --- |
| Canonical `apps/web/src/components/workflow/WorkflowWorkspace.tsx:140` | Existing Today, Schedule, Patients, Documents, Templates plus permitted Manager/Insurance navigation; collapsing sidebar, practice/location context, `.wf-topbar-tools` with time zone and LanguageSelector. | Add Notifications entry and top-bar bell to this shell, preserving current location and language controls. A notification scope must be visible rather than silently switching locations. |
| Canonical `WorkflowWorkspace.tsx:129` and `:215` | Actual request creation hardcodes recipient `channel: "email"`; due date resolves to 17:00 and expiry to 23:59 in the location zone. RequestCards already draws deliveryStatus, due date, Send reminder, Reissue link and Cancel request. | Extend this existing request form/card into channel selection, time-aware due/expiry, precise independent status and safe recovery; do not add a competing request action elsewhere. |
| Canonical `WorkflowWorkspace.tsx:147` | “A little attention” work items include Assign to me / Remove my assignment through `work-items/{id}/assignment`, gated by `workManage`. WorkItem DTO includes assigneeUserId and dueAt. | Staff event triggers attach to existing assignment commands. Add current owner/due context and a recipient picker only for authorized managers; link alerts to patient/document detail. |
| Canonical `StaffPaperwork.tsx` | Loads exact libraryItems and notifications from `paperwork/patients/{id}`; notification presentation is currently state/status plus setup-required help. | Expand the existing Paperwork status area into exact-copy notification status, per-channel attempts and permitted resend/recovery. Copy availability stays separate from notice outcome. |
| Canonical `FormsStudio.tsx:33` and `:46` | Current prepareRequest uses recipient channel `local_review` with `delivery.sendNow: false`; form schema has `delivery.emailCopy`, signing/secure-copy configuration and setup help. | Preserve local review as an explicit assisted mode. Design activation and current recipient-policy checks before enabling real send; extend this secure-copy setting consistently for email/SMS policy. |
| Canonical `PatientWorkflow.tsx`, `PatientPaperworkLibrary.tsx`, `PatientAccountCode.tsx` | Working restricted request UI, closed-request help, form/sign/upload completion, saved-copy route `/patient-paperwork`, account-code access and released-copy list. | Initial request links and completed-library notices require distinct navigation/access purposes. Extend these patient entry screens rather than creating an unrelated patient app. |
| Canonical `apps/web/src/lib/api/workflow.ts` | Workflow adapter already has scoped location URL validation, allowedActions/capabilities, If-Match revisions, stable idempotency keys and clear-on-denied hooks. | Add delivery DTOs and notification reads/commands to this adapter, preserving the established revision, authorization and retry conventions. |
| Canonical `workflow.css` | Current app already uses white, #0067e8, #26332d ink, #58665e muted, #e3e9e6 rules, 198px sidebar and responsive layouts. | This is the most direct current visual source. The new notification surfaces can match it without migrating the older mirror's sage implementation. |
| `careiq-practice-mobile/apps/web/src/components/PracticeWorkspace.tsx` | Schedule, Patients and three revenue modules; practice picker, location-scoped content, account controls and transient success toast. No persistent notifications entry point. | Put a named Notifications control in the top bar, with the full notification center reachable from the sidebar/account area. A success toast is feedback about an action; it cannot substitute for an inbox. |
| `RevenueCycleWorkspace.tsx`, `RevenueCommandForm.tsx` | Real record owners/assignment action, follow-up times, unassigned and follow-up-due views; actor/source activity detail. | Emit events at committed assignment/follow-up changes. Link alerts to the existing case detail. Keep task state authoritative in the record and show its current state after a notification is opened. |
| `PracticeSettings.tsx` | Staff invitations, location membership, role changes and practice ownership transfer. | Practice ownership security notices are distinct from ordinary case-owner changes. Link a recipient who lacks clinical access to account/practice administration only. |
| `apps/web/src/lib/capabilities.ts` | Server-derived patient/appointment capabilities; explicit grants fail closed. | Add explicit inbox read, patient delivery, delivery recovery and notification-rule capabilities. A badge must be authorized too. |
| `apps/mobile/app/index.tsx`, `docs/design/mobile-architecture.md` | Expo iOS/Android foundation and setup only, with no patient records or operational screens. | Native versions are new design work, not minor changes to a working mobile inbox. Access-context, foreground privacy, device token lifecycle and navigation must precede native release. |
| `outputs/careiq-forms-v4/architecture/*.md` | Existing documented delivery attempts/outbox and provider-unavailable semantics; proposed completed-paperwork notices, event history, preferences, verified webhooks and reconciliation. | Extend that model. Do not create a second competing delivery record or queue. Differentiate request, reminder and completed-copy notice. |
| `outputs/careiq-forms-v4/design/review-v5/*` | Latest forms design pass requires fixed white/light surfaces, Signal blue and padded white dropdown menus. Corrected status wording distinguishes provider acceptance, delivery and app access. | Continue this visual language and truthful status vocabulary. The older application sage palette is an older implementation reference. |
| `outputs/careiq-workflow-design/prototype-logic-v2.js` | Earlier work queue, documents and request details, with recipient, due time, failed delivery recovery and cancellation. Old labels include “Request sent” and a single delivery field. | Keep the workflow/navigation pattern, update the delivery status model and distinguish new attempts from request replacement. |
| `outputs/careiq-manager-insurance/design-handoff.md` | White workspace, #0067e8 primary, ink #26332d, muted #607067, thin #e3e9e6 rules, location scope, queue/detail and follow-up owner. | Match this current operational UI. Maintain visible practice/location scope, exact as-of time and permission-aware details. |

Root `AGENTS.md` prohibits changes to synced `sources/`. Web's nested `AGENTS.md` requires version-specific Next.js guidance before writing application code; this audit makes no application changes.

Canonical root `AGENTS.md` was also read: it identifies that checkout as authoritative, preserves local changes and requires implementation documentation under its `docs/`. This subtask remains read-only there; root delivery can decide the appropriate handoff copy when it has filesystem authorization. Canonical native `apps/mobile` is absent; the project mirror contains only the Expo foundation. The product's current supported interface-locale catalog and `LanguageSelector` must be reused; notification locale remains distinct from the document's frozen language.

## Minimum screen inventory

| ID | Surface | Required contents and actions |
| --- | --- | --- |
| P01 | Send patient request | Patient and authorized recipient context, exact request/template, masked verified destinations, permitted channel choices, delivery language, due time and time zone, automatic reminder policy, per-channel preview and final Send request action. No unrestricted free-text message box by default. |
| P02 | Patient communication profile | Email/phone verification status, category/channel permission, representative/confidentiality restrictions, notification locale and preferred channel. Separate contact correction, verification and preference changes; a staff edit does not silently verify the destination. |
| P03 | Request created / dispatch pending | Request exists and can be worked independently of delivery. Show “Request created. Delivery queued.”, recipient/channel and operation progress; show provider-unavailable truthfully without marking sent. |
| P04 | Request detail + delivery timeline | Independent request state, due time, latest recipient scope, per-channel dispatch/outcome, ordered attempt history, safe failure reason, next retry/reconciliation time and permitted actions. Distinguish cancel request, cancel queued message, resend, reminder and replace/reissue link. |
| P05 | Send reminder / resend | Revalidate current request lifecycle, verified destination, preferences, cooldown and latest activity. Confirm purpose/channel, show exact preview, explain if no eligible channel. Missing/uncertain original outcome offers Check delivery status first. |
| P06 | Delivery attention queue | Active location scope; filter Initial requests / Reminders / Completed copies, channel, Needs attention, Unknown outcome, Bounce, Suppressed and queued age. Group messages by originating request/copy; show count units, last update and owner. |
| P07 | Resolve delivery problem | Masked destination, plain-language reason, latest provider observation and safe next action. Correct and verify contact, request supported alternate channel, review suppression, reconcile or record assisted follow-up. A hard bounce/STOP cannot be bypassed by pressing Retry. |
| P08 | Reminder policy | Practice/location defaults, named eligible categories, event-relative schedule, quiet hours/time zone, per-purpose caps/cooldown, fallback policy and completion/cancel/expiry stop conditions. Show schedule examples and a policy version. |
| P09 | Completed-copy status | Exact immutable copy/version and signed-versus-unsigned label, required-signer completion, independent in-app availability and independent notification state. Email/SMS failure never removes the copy or changes signature state. |
| P10 | Patient email gallery | Request, reminder, completed copy, contact verification and supported help content. HTML and plain-text variants, locale, safe sender/subject/footer and small-screen stacking. Preview generic content only; no PDF attachment, answer, document title, patient name or diagnosis by default. |
| P11 | Patient SMS gallery | Request, reminder, completed copy, verification, STOP/START/HELP response. Short first-party HTTPS links, sender identity, category-appropriate consent wording and no patient/form details. Display segment estimate as an implementation review aid, not a patient-facing control. |
| P12 | Patient entry/resume | Link routes to the exact allowed action after current access checks. Request links retain restricted scope; completed-copy links require account/current audience access. Draw expired/revoked/completed link, wrong account, verification unavailable and supported help paths. |
| P13 | Patient communication preferences | Current permitted channel/category, verified destination, locale, plain-language save outcome, withdrawal timing and supported alternate communication. SMS STOP and email preference withdrawal have distinct confirmed states. Do not tie communication opt-in to signing consent. |
| S01 | Notification popover | Latest authorized alerts, unseen count, New/Earlier grouping, event type/time, Mark read and View all. Do not show sensitive information outside authenticated authorized UI. Clear empty/loading/error states. |
| S02 | Staff notification center | Unread/All and Assignment / Owner changes / Overdue filters; explicit scope and counts, new-event retention when browsing, pagination, preference shortcut and bulk Mark read. Items show origin, time, current case state and a clear Open record action. |
| S03 | Staff event detail | Assignment actor/from/to, reason when recorded, due time/time zone, current record status and permission-aware deep link. Display “This item has since been reassigned/completed” instead of actioning obsolete event data. |
| S04 | Staff preferences | In-app baseline and permitted optional channels, per-category instant/digest/quiet-hour preferences, time zone and escalation visibility. Explain mandatory security/admin notices separately. Preferences govern delivery, never task ownership/access. |
| S05 | Manager notification rules | Eligible role/location audiences, overdue threshold, recurrence/maximum, escalation target and fallback for unassigned/inactive owner. Preview who receives what and when. Prevent rules from expanding clinical access. |
| S06 | Assignment / owner change confirmation | Originating record's owner picker and optional reason, conflict state, eligible assignee check and truthful confirmation: owner saved; notification queued separately. Self-assignment normally does not generate a redundant personal alert. |
| S07 | Overdue digest / escalation | One grouped alert per recipient/window, count and oldest due time, authorized View overdue work link; scheduled notifications cancel/re-evaluate after task completion, due-date change or owner change. |
| S08 | Native push/device settings | Ask after user value/context, OS permission denied/restricted states, Open device settings, signed-out device and token cleanup. Generic lock-screen copy; authenticate and refresh access before opening a protected record. |
| A01 | Delivery setup and service health | Separate email/SMS provider readiness, approved sender/number, test mode, verified domain/channel, webhook health, queued age and operational incident state. Admin-only detail; staff see actionable “Delivery temporarily unavailable”. |

## Important state distinctions

- **Request:** draft/open/partially complete/completing/complete/declined/expired/cancelled. A reminder is eligible only while the required action remains open and the purpose permits it.
- **Dispatch:** queued/submitting/provider accepted/unknown/failed/cancelled. “Provider accepted” means the service accepted the call. An ambiguous timeout is “Delivery status being checked”, with ordinary resend blocked until reconciliation or an explicit controlled resolution.
- **Outcome:** delivery unconfirmed/delivery reported/bounced/complained/suppressed. A later bounce can supersede a delivered observation without erasing it. “Delivered” never implies read, identity verified, signed or reviewed.
- **Channel eligibility:** missing destination/unverified/permission absent/opted out/confidential restriction/suppressed/provider unavailable/ready. No fallback to another channel without its own current permission and verified destination.
- **Message purpose:** initial request/reminder/reissue/completed-copy/resend. Initial delivery is not a completed-copy announcement. Reissue rotates live request authority; a resend of a completed-copy notice retains the exact copy.
- **Staff notification:** unread/read/archived (if offered), independent of pending/in progress/completed/overdue work. Opening or marking read never completes the task; finishing work need not erase the historic notification.
- **Common UI:** loading; genuinely empty; filtered no matches; transient service error; last-successful snapshot with timestamp; offline; access removed; stale revision/conflict; recoverable save error; focus restored on dialog close.

## Trigger and recipient design

| Event | Intended audience and practical default |
| --- | --- |
| New work assigned | New eligible active assignee, excluding the initiating actor when self-assigned; one event for the committed transition. |
| Case owner changed | New owner receives an assignment notice; former owner receives a concise ownership-change notice if still authorized and the change affects their work. Actor gets ordinary save feedback. Do not send two duplicate alerts to the new owner. |
| Work becomes overdue | Current owner; approved location queue/manager fallback if unassigned or inactive. One initial threshold event; re-evaluate before any escalation. |
| Work remains overdue | Approved reminder/digest/escalation window and cap. A persistent overdue flag must not generate a new alert every scheduler scan. |
| Patient delivery needs attention | Current accountable workflow owner or eligible location queue, grouped by the underlying request/copy. Do not broadcast patient delivery failures to every practice administrator. |
| Practice ownership transfer | Prior/new practice owner through a separately protected account/security event. This is not a clinical case-owner alert and need not reveal patient records. |

Assignment, completion and due-date changes must update the authoritative work record before alerts are generated. Scheduler and dispatch-time checks use the current owner/status. A historic notification records what happened while its destination opens the current record after access validation.

## Copy patterns

| Context | Suggested copy |
| --- | --- |
| Request email subject | “A request from your care team” |
| Request email | “There is a request for you in CareIQ. Open the secure link to continue.” Button: “Open request”. |
| Reminder email subject | “Reminder: a request is waiting” |
| Reminder email | “A request is still waiting for you in CareIQ. Open the secure link to continue, or contact your care team if you need help.” |
| Completed email subject | “Your paperwork is ready” |
| Completed email | “Your paperwork is available in your account. Sign in to view or download your copy.” Button: “View my paperwork”. |
| Request SMS | “CareIQ: A request from your care team is ready. Continue securely: {firstPartyLink}. {approvedHelpOptOutFooter}” |
| Reminder SMS | “CareIQ: A request is still waiting. Continue securely: {firstPartyLink}. {approvedHelpOptOutFooter}” |
| Completed SMS | “CareIQ: Your paperwork is available. Sign in to view your copy: {firstPartyLink}. {approvedHelpOptOutFooter}” |
| Queued | “Delivery queued” / “The request is saved. We’re preparing the message.” |
| Accepted | “Accepted by email service” / “Delivery has not been confirmed.” |
| Unknown | “Delivery status being checked” / “We’re checking the earlier attempt before sending again.” |
| Bounce | “Email could not be delivered” / “Check and verify the address before sending another message.” |
| Provider unavailable | “Message delivery is temporarily unavailable. The request remains open.” |
| Completion plus failed notice | “Copy available in My documents. The notification needs attention.” |
| Staff assignment | “You were assigned work” / “Jamie assigned you a follow-up at Downtown.” (Protected app detail can show the minimum authorized case context.) |
| Staff ownership change | “Work ownership changed” / “Jamie reassigned this item to Morgan. Open the record for its current status.” |
| Staff overdue | “A follow-up is overdue” / “Due today at 9:00 AM · Downtown”. |
| Generic push | “CareIQ: You have a work update. Open CareIQ to view it.” |
| Stale notification | “This item has since been completed.” / “This item has since been reassigned.” |
| Read action | “Mark read”. Do not use “Resolve” unless the action actually changes the underlying work. |

Patient message sender, branding and footer are policy decisions: even a recognizable sender can reveal a care relationship. Use the approved confidentiality rules, do not infer permission from a stored phone/email, and have implementation verify current regional/service requirements. These are product patterns, not legal wording approval.

## Responsive and native behavior

- **Web desktop:** inbox list/detail split; delivery queue with compact rows and explicit channel/outcome; accessible dialog for request, reminder and recovery; keyboard focus/escape/return and browser deep-link/history support.
- **Tablet:** preserve context and outcome labels when reducing columns; detail becomes a wider sheet or route. Avoid a horizontally scrolling required-action table.
- **Phone web:** full-screen detail, stacked channel cards, sticky primary action with safe-area padding; keep due date/day and time zone visible; no important controls inside hover-only menus.
- **iOS:** safe areas, dynamic type, native permission prompt preceded by explanation, universal links with web fallback, swipe/back behavior that preserves permitted drafts. Generic push previews; authenticated foreground refresh before protected content.
- **Android:** app links, back stack, notification-channel settings and denied-permission path; reliable background handling without assuming a notification was shown; large-font testing and generic lock-screen content.
- **Across platforms:** 320/390/768/1024/1440 widths; 200% zoom/text; long translated copy; 44–48px main touch targets; text plus icon status; announce asynchronous result without repeatedly reading the entire queue; reduced motion; no PHI in local persistent draft caches or analytics.

## Acceptance examples for implementation handoff

1. A queued initial request immediately completed by the patient is rechecked before dispatch; no obsolete action request is sent.
2. Email provider timeout after possible acceptance shows unknown and reconciliation; repeating the UI action does not blindly produce a new send.
3. SMS STOP suppresses subsequent eligible automated SMS, while the authorized in-app request/copy remains available and alternate channels remain independently governed.
4. A required provider countersignature still pending prevents a “completed copy ready” notice even if the patient has signed.
5. Contact corrected after a hard bounce requires verification and current permission before a new attempt; the older attempt and reason remain in history.
6. A staff member marks an overdue notification read; the record remains overdue until its work/due state changes.
7. Work reassigned before a scheduled overdue digest is dispatched uses current eligible ownership and avoids sending patient detail to a former owner who lost access.
8. A deep link to another practice/location never switches context invisibly or leaks cached content. The user sees the authorized context chooser or a safe access-unavailable screen.
9. Access revoked while the inbox is open removes protected content and counts and blocks record actions; ordinary read-state preferences cannot restore access.
10. New owner receives one useful notification for an assignment transition, rather than separate duplicate assignment and ownership alerts.
