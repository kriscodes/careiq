# Patient delivery and staff notifications

This implementation connects committed paperwork requests and completed copies to a durable delivery queue, adds patient communication choices, and supplies a staff inbox for assignments, ownership changes and overdue work. External delivery and the background worker default to disabled. Implementation or a successful local test does not activate a sender or establish production acceptance.

See the [design handoff](design/patient-delivery-and-staff-notifications/design-handoff.md), [existing workflow guide](workflow-implementation.md) and [API production release guide](api-production-release.md). The actual API paths below follow the application's explicit location context; they differ from some paths proposed in the design handoff.

## Application and API boundaries

| Area | Implemented interface |
| --- | --- |
| Patient delivery | `/api/v1/locations/{locationId}/communications`: deliveries and detail, readiness, templates, patient preferences, endpoint confirmation, purpose permission events, request delivery commands, pre-dispatch cancel, original-send check and reminder policy. |
| Staff inbox | `/api/v1/locations/{locationId}/workflow/notifications`: recipient-only list/detail, read/unread, archive, snooze and bounded read-all. |
| Staff configuration | Location-scoped `/workflow/notification-preferences` and `/workflow/notification-policy`. Manager policy returns currently eligible explicit recipients. |
| Patient choices | Authenticated `/api/v1/patient-paperwork/communication-preferences`, separate from the restricted request-cookie session. |
| Provider callbacks | Raw-body POST `/api/v1/delivery-callbacks/{routeKey}/resend`, `/twilio` and `/twilio-inbound`, registered before JSON parsing and browser authentication. |

All staff reads and commands require current directory membership, active local enrollment and an explicit active location assignment. Work read permission is `org:appointments:read`; routing changes require `org:workflow:configure`. Patient communication reads require patient/document read permission; sending additionally requires `org:requests:send`. Recording a confirmed endpoint or purpose permission additionally requires the existing `paperworkManage` authority. Assignment, an admin role label and a notification never grant record access.

Patient choice contexts are derived from current authenticated adult-self portal grants. Short-lived signed context tokens bind selection to the account, session and grant. Patients can change purpose/channel choices for registered endpoints; this route cannot edit contact details, bind another account, clear provider suppression or change signing consent. Profile revisions and idempotency records are helper-controlled. SMS STOP and START append provider evidence; START leaves local purpose withdrawals in place.

## Durable delivery and recovery

Migrations `0039_notification_delivery`, `0040_staff_notifications` and `0041_patient_communication_preferences` add endpoints and append-only permissions, delivery intents and attempt facts, callback receipts, destination suppression/release evidence, reminder policies, staff events/receipts/email batches, exact read-all snapshots and helper-only portal preference records. Existing unavailable delivery attempts remain historical facts; no migration infers permission or delivery from an address.

Request creation/reissue and intent creation share the existing transaction and audit/outbox foundation. A queued intent is not a provider attempt. Request links are encrypted using AES-256-GCM with intent-bound authenticated data; ordinary outbox payloads contain identifiers. Dispatch rechecks current endpoint/version, purpose permission, provider suppression, adult-self eligibility, request generation, expiry and remaining action. Completed-copy notices remain pinned to the released exact library version and portal grant; notice failure does not remove the copy.

Patient attempts have a persisted submission boundary and lease token. Staff email batches likewise persist `submitting` before the external call. An expired submission or uncertain acceptance enters lookup-only recovery using the original mapping. Neither the check command nor an unknown result creates a second send. Known-safe transient rejections have finite retries. Verified late provider facts remain distinct from workflow completion and personal read state.

Unknown sends without a provider message reference cannot currently be found automatically through Resend/Twilio's status APIs. Preserve unknown and use an authorized operator investigation in the original provider account. Do not reset the intent, rotate its key or issue a replacement solely because lookup is unavailable.

Automatic patient reminders start disabled per location. Supported slots are 48 and 24 hours before due time, with a confirmed recipient IANA zone and default 09:00–18:00 window. Missing zone/due time, elapsed due time or a deferral crossing due prevents the occurrence. Dispatch checks lifetime/cooldown limits and a request/destination daily cap. Completion, cancellation, request reissue, changed authority/destination or an obsolete due generation prevents stale reminders.

## Staff behavior

Ownership changes create source events in the same database transaction. New owners and eligible previous owners receive one transition notice, excluding a human actor; a no-op does not create another event. In-app inbox refresh materializes the signed-in recipient's eligible committed alerts without requiring the external worker or sending email.

Overdue policy requires an explicit fallback queue; escalation requires a finite explicit audience. Current due and owner generations deduplicate occurrences. Escalation uses the location's Monday–Friday 09:00–17:00 calendar and configured holidays, with an eight-business-hour default. The worker rechecks membership/location/work-read permission and reconciles an ineligible owner to unassigned work. There is no practice-wide clinical fallback.

Read/unread, archive and snooze change only that recipient's receipt. Read-all uses an expiring server-stored list of at most 10,000 authorized IDs, bound to location, membership and permission fingerprint. Later arrivals stay unread even when their event time is older. Source detail reports current, reassigned or resolved work independently of read state.

Personal preferences are stored per selected location. Staff email defaults off in each recipient’s preferences and also requires the global provider gate and configured staff URL. Optional staff email uses a verified directory email, confirmed staff zone, quiet hours and immediate/daily digest preference. External copy is generic and contains no patient or work details. Durable batches pin the verified destination hash and preference revision; deferred sends recheck current work. Staff Resend callbacks are ignored by the patient callback handler; the staff worker polls the original provider reference for outcome evidence.

## Operator configuration

Keep credentials in the deployment secret store. Do not put real values in the repository, screenshots, logs, browser configuration or ordinary application settings.

| Setting | Purpose and default |
| --- | --- |
| `CAREIQ_DELIVERY_ENABLED` | Global provider send/lookup gate; only literal `true` enables it. Otherwise adapters remain disabled. |
| `CAREIQ_DELIVERY_FINGERPRINT_KEY` | Independent 32-byte key encoded as exactly 64 hexadecimal characters for destination HMACs. Keep it consistent across deployments sharing a sender account so opt-outs match. |
| `CAREIQ_DELIVERY_PAYLOAD_KEY` | Separate 32-byte key, exactly 64 hexadecimal characters, for sealed request links. Existing ciphertext needs the original key. |
| `CAREIQ_DELIVERY_PUBLIC_ORIGIN` | Fixed HTTPS patient application origin, without path, query, credentials or fragment. |
| `CAREIQ_RESEND_API_KEY`, `CAREIQ_RESEND_FROM`, `CAREIQ_RESEND_ACCOUNT`, `CAREIQ_RESEND_WEBHOOK_SECRET` | Email credentials, approved sender, stable account namespace and Svix signing secret. All are needed for email readiness. |
| `CAREIQ_RESEND_PREVIOUS_WEBHOOK_SECRET` | Optional previous signing secret during a controlled rotation. |
| `CAREIQ_TWILIO_ACCOUNT_SID`, `CAREIQ_TWILIO_AUTH_TOKEN`, `CAREIQ_TWILIO_FROM` | SMS account credentials and approved E.164 sender. |
| `CAREIQ_TWILIO_CALLBACK_URL`, `CAREIQ_TWILIO_INBOUND_URL` | Exact public HTTPS callback URLs ending in the enrolled route's `/twilio` and `/twilio-inbound`. No query or fragment in configuration. |
| `CAREIQ_TWILIO_PREVIOUS_AUTH_TOKEN` | Optional prior token for callback verification during rotation. |
| `CAREIQ_SMS_FOOTER` | Reviewed sender/region STOP, HELP and rate wording appended to SMS copy. Required for SMS readiness. |
| `CAREIQ_DELIVERY_CALLBACK_ROUTE_KEY` | Opaque 24–100 character URL-safe route handle. It selects server enrollment and is not authentication; signatures and account/reference matching remain required. |
| `CAREIQ_STAFF_APP_URL` | Fixed HTTPS application URL for generic staff email. Its origin is used for the sign-in link. |
| `CAREIQ_NOTIFICATION_WORKER_ENABLED` | Worker scheduling gate, default disabled. Does not disable the in-app inbox. |
| `CAREIQ_NOTIFICATION_WORKER_INTERVAL_MS` | Default 30,000; supported range 5,000–300,000. |
| `CAREIQ_NOTIFICATION_WORKER_SCOPES` | JSON array of explicit enrolled `{practiceId,locationId,userId,membershipId,orgId}` tuples; maximum 50, one per location. |

The enrolled principal must retain current `org:requests:send`, `org:documents:read` and `org:appointments:read`, active enrollment and that explicit location assignment. Every tick reauthorizes the tuple; the runtime never discovers tenants through unscoped clinical reads. Callback resolution also uses these enrolled scopes, including when the worker is paused. Configuring a callback route therefore requires valid scope configuration even while worker scheduling is disabled. Membership or location changes require an enrollment review; do not substitute an elevated database login.

Resend signatures use the exact raw request, signed event ID/timestamp and a five-minute replay bound. Twilio verification uses the configured public URL and every received form field; the account SID must match. Provider event IDs and body hashes deduplicate receipts. Configure Twilio's supported opt-out handling so verified `OptOutType` STOP/START events reach the inbound route. HELP and unsupported replies require the approved provider-side support behavior; this implementation is not a clinical SMS inbox.

## Activation and verification

1. Keep sending and worker scheduling disabled. Review migrations and the existing ledger against a backup; rehearse migration replay only in an isolated loopback `careiq_test` database. Preserve the restricted runtime and separate audit-reader roles.
2. Run the existing release verifier as the actual restricted runtime. Notification catalog checks require forced RLS, exact location/recipient policies, permitted column grants, enabled mutation/integrity/ownership triggers, and reviewed helper definitions. Private portal idempotency rows must have no direct runtime privileges. A privileged migration connection cannot substitute for this check.
3. Configure one approved sender channel and one synthetic location enrollment. Verify DNS/sender approval, applicable provider agreements, callback reachability, account qualification, opt-out/HELP behavior, regional SMS wording and approved templates. Patient templates currently ship in English; staff generic email supports EN/ES. Do not treat the design's proposed translated patient copy as approved production copy.
4. Exercise the selected provider's sandbox with synthetic destinations and controlled callbacks, including duplicate/reordered/invalid receipts, timeout after acceptance, crash/restart, opt-out races and missing references. Record evidence separately from local adapters and browser screenshots.
5. Enable one reviewed channel and scope, then the worker, and observe queue age, unknown outcomes, callback failures, retries and suppression. Patient reminders and staff overdue/escalation remain separate location policy choices. Keep broader rollout subject to the existing production release process.

Use the repository's supported Node and pnpm versions. Relevant validation commands are `pnpm --filter @careiq/api typecheck`, `pnpm --filter @careiq/api test`, `pnpm --filter @careiq/api db:verify`, the web tests/browser checks and the root `release:check` suite. Database tests require an explicitly supplied loopback `TEST_DATABASE_URL` whose database is exactly `careiq_test`; release verification uses the separately configured restricted runtime `DATABASE_URL`. Never point destructive tests or replay at hosted development data.

Local tests can verify queue/receipt logic, authorization, schema constraints, synthetic provider behavior and browser flows. They do not establish real sender activation, carrier behavior, provider contract approval, installed-device acceptance or a hosted migration result. Store actual run records under `docs/verification/`; this guide itself is not a record of tests or live sends.

To pause external operations, disable the global delivery gate and/or worker scheduling while retaining callback enrollment for receipt ingestion. Keep in-app work and completed-copy access available. Investigate unknown sends against the original provider reference before any manual replacement. Key rotation, repaired portal identity and destination replacement require explicit reviewed migration/authority decisions; the current implementation does not provide a multi-key rotation or identity-transfer shortcut.

## Provider references checked during implementation

The adapters follow the providers' documented request and signature formats: [Resend send email](https://resend.com/docs/api-reference/emails/send-email), [Resend webhooks](https://resend.com/docs/webhooks/introduction), [Twilio webhook fields](https://www.twilio.com/docs/messaging/guides/webhook-request) and [Twilio request validation](https://www.twilio.com/docs/usage/security#validating-requests). These references do not substitute for the synthetic sender acceptance in step 4.
