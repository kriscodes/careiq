# Notification implementation verification — 2026-10-18

## Current boundary

Implementation is preserved in this task's writable staging output. It has not been installed into the canonical `/Users/kristian/Documents/Server/CareIQ` checkout. Automatic approval review reports “Selected model is at capacity” for the isolated local database migration; the final canonical installation review also timed out before execution. No migration, commit, push, deployment or live patient/staff message was performed by this implementation task.

## Executed checks

| Check | Observed result |
| --- | --- |
| API TypeScript | Passed for staged application source. |
| Web TypeScript | Passed for staged application source. |
| Web ESLint | Passed for all staged web source. |
| Web unit tests | 90 passed, 0 failed, 0 skipped. Includes 11 communications adapter cases and exact-copy sign-in return validation. |
| Focused API tests | 38 passed, 0 failed, 0 skipped: delivery provider/policy (17), patient routes/callbacks (3), staff policy (5), worker (3), portal token (1), notification release catalog checker (9). All provider HTTP is synthetic. |
| Drizzle metadata | Generated progressive 0039/0040/0041 snapshots offline; final schema generation reports no changes. This checks model metadata, not SQL execution. |

The focused API run uses `node --import tsx --test` with `patient-delivery-policy`, `patient-delivery-routes`, `staff-notification-policy`, `notification-worker`, `portal-preference-policy` and `notification-release-check` tests. The catalog checker tests use synthetic catalog fixtures; the actual database catalog remains unverified.

## Prepared acceptance still required

- Apply migrations only to isolated loopback `careiq_test`, then run the full API regression suite. Patient/staff/portal restricted-role service fixtures cover delivery evidence and leases, retry repair, automatic slot consumption, recipient privacy, generations, revisions, replay, suppression, account revocation and concurrent saves. Their safe skip without an isolated test URL is not a passing database test.
- Run the release verifier using the actual restricted runtime credential and separate audit-reader configuration. Rehearse complete migration replay and ledger consistency; do not use hosted development data.
- Run the staff notification HTTP test and browser `communications.spec.ts` interaction suite. Chrome could not launch inside this sandbox; elevated test execution was blocked by automatic approval review. The earlier standalone design prototype's test results are not implementation acceptance evidence.
- Complete synthetic provider-account/sender/callback acceptance, opt-out/HELP handling, approved patient copy and any applicable operational/provider review before activation. Patient templates currently ship only in English; staff UI supports English and Spanish.

## Review corrections included

The staged implementation preserves the prior publication guards and typed nullable notification record, independently checks SMS paperwork permission, retains the exact copy through sign-in, preserves uncertain-save retry keys during library reloads, prevents active-notice duplicate retries, repairs only failed channels, preserves accepted/delivered facts during failed lookup, and isolates stale worker enrollments. Receipt changes do not complete source work.

## Installation

The task output includes a reviewed-file manifest, a Git patch and an installer that checks baseline SHA-256 hashes before copying only changed notification files. It preserves unrelated uncommitted insurance work, backs up replaced files and does not run migrations or Git mutations. Installation must occur through a writable canonical workspace or a functioning approval review. Resolve any changed-baseline conflict explicitly before applying.
