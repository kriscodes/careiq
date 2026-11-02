# Manager team activity

Local implementation, November 2, 2026. This extends the existing Manager dashboard with activity across the current authorized location. It does not establish a hosted release or a connected payer integration.

## Manager workflow

The Manager dashboard includes a separate Team activity view for appointments, insurance observations, and follow-ups. Managers select an activity day, the person who performed the action, and an action category, then inspect the newest-first history. The existing appointment-day overview continues to describe visits scheduled for its selected service date.

Activity day means the server recording date in the working location's time zone. A booking made today for a future visit belongs to today's activity. An insurance observation entered today belongs to today's activity even if staff checked the payer portal yesterday. The underlying observation retains its original source time.

The person filter identifies the actor who performed the action, rather than the current case owner. Historical actors remain selectable for days on which they acted, including staff who have since left the team. Staff labels reuse the existing stable account suffix convention; they do not invent directory names.

## Event and count definitions

The history includes successful staff actions only. Patient, service, integration and background-job actors, reads, denied or failed commands, command acceptance, retries and replay records are excluded. A future automation reporting view can define its own actor scope.

- Appointments: booking, updating or rescheduling, status changes, and cancellation. The canonical command event is counted once; companion detail events are excluded.
- Insurance: case creation, policy correction, recorded coverage results and evidence corrections. The historical result is preserved, rather than replaced with the case's current coverage state. Only constrained coverage and source values appear in this view.
- Follow-ups: insurance assignment/deadline changes, work assignment and completion, and request reminder/reissue actions. These are recorded actions, not a count of currently open tasks or a claim that a message was delivered.

Summary counts cover all events matching the date, person and category filters, independent of how many history rows have been loaded. Counts describe actions; corrections and later changes remain separate historical actions. This view does not introduce staff performance scores or measured time-saving claims.

## API and permissions

`GET /api/v1/locations/{locationId}/insurance/manager/activity`

Query parameters: `from` and `to` (inclusive local action dates, at most 31 days), optional `actorId`, `category` (`all`, `appointments`, `insurance`, `followups`), `limit` (1–100, default 50), and optional opaque `cursor`. Unknown parameters and malformed values are rejected. The UI initially exposes one activity day.

The response envelope contains `data` with `from`, `to`, `timeZone`, `asOf`, filtered `summary`, date-scoped historical `actors`, `items`, and `pagination`. Items include event identity, recording time, actor, action, category, affected record reference, successful outcome, and constrained result/source when available. The person options cover the selected date range before applying the person/category filter.

Every request requires current patient and appointment read access, work management and explicit activity-read permission, plus active practice/membership/location assignment. A manager plan or view does not grant protected audit access. Responses are marked no-store. Existing independent failure capture remains in effect, and unavailable audit capture withholds the response.

The dedicated `audit.manager_activity(date,date)` helper exposes only the approved event fields, checks the active location scope, and uses local midnight boundaries that account for daylight-saving changes. The application runtime retains no direct SELECT access to raw audit tables. Pagination uses the complete timestamp precision and event ID, with signed cursors bound to the requesting member, practice, location, dates, person, category and page size.

## Local activation and verification

Migration `0048_manager_activity.sql` is additive. Apply it through the existing verified migration runner before enabling the API; the runtime release check requires the protected helper and its restricted grants. Previously applied migrations remain unchanged.

Verification and remaining hosted acceptance are recorded in [the November 2 verification record](verification/manager-team-activity-2026-11-02.md). Only the runner-owned loopback test/review databases are authorized for this work. Source changes are prepared for a local commit. No hosted migration, push or deployment is included.
