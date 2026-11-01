# Owner-operator access — October 31, 2026

This record covers the local implementation in the canonical CareIQ checkout. It follows the owner’s decision that a practice owner should start with full normal operational access and be able to remove workspace areas or locations afterward. Earlier navigation, authentication and account-lifecycle evidence remains in the [Practice Home record](practice-home-2026-10-30.md). This change does not establish production or inbox acceptance.

## Current policy

The current database owner receives the preset only with a fresh `org:admin` membership, matching active local enrollment, active location-mode practice and active personal account. Other administrators and members retain their existing provider grants. The preset does not change Clerk role configuration or bypass practice/location isolation.

The 17 reviewed normal permissions are:

| Area | Permissions |
| --- | --- |
| Patients | `org:patients:read`, `org:patients:create`, `org:patients:update` |
| Appointments | `org:appointments:read`, `org:appointments:create`, `org:appointments:update` |
| Documents | `org:documents:read`, `org:documents:upload`, `org:documents:review`, `org:documents:archive` |
| Requests and requirements | `org:requests:send`, `org:requirements:waive`, `org:requirements:manage` |
| Work and activity | `org:work:manage`, `org:activity:read` |
| Setup and patient account administration | `org:workflow:configure`, `org:paperwork:manage` |

Protected audit, platform/global operations, personal-account closure and patient portal identity grants stay separately authorized. Patient account administration still requires effective document/configuration/paperwork permissions and recent verified authentication. Typed ownership confirmation and the existing sensitive-action safeguards remain.

**My workspace access** exposes workspace-area controls and all current/future versus specific active locations. Effective permissions are provider grants plus the current-owner preset, minus saved owner restrictions; a provider grant cannot override an explicit owner denial. All workspace areas and locations can be disabled while ownership, settings and access restoration remain available. Saved profiles are actor-bound and revision-checked. Unknown permission keys, foreign identities, invalid/closed locations and stale revisions are rejected.

All-locations access uses ordinary assignments. The reviewed migration initializes existing active owners; onboarding and transfer initialize the checked new owner; location creation/reopening follows the current owner’s saved all-locations choice. Narrowing removes ordinary assignments. Clinical transactions still recheck active practice, membership, location and assignment under forced row security.

Ownership transfer requires the current recorded owner and an eligible active administrator with an active personal account. It initializes the recipient’s full preset and all active/current and future locations. A later request by the former owner receives only independently granted staff permissions, without the owner preset or management controls. Historical records and explicit staff grants are retained.

## Implementation boundaries

- `owner-operator-policy.ts` contains the bounded preset and restriction validation; `owner-operator-access.ts` resolves it using the same transaction’s verified practice/actor context and current database owner.
- Practice context, location authorization, workflow, insurance and patient-delivery staff routes consume effective grants. Background notification recipient, dispatch and worker checks use the same resolver under each identity’s actor context; inactive accounts remain ineligible.
- `practice_owner_access` stores only the owner’s disabled permission keys, all-locations choice and revision. Migration 45 and the schema/release checks preserve forced row security and narrow runtime grants.
- The existing personal patient library, public request-token flows, legacy-mode compatibility and protected-audit authorization remain separate. No provider role grant is used to make the owner preset work.

## Verified automated evidence

| Check | Result |
| --- | --- |
| Complete API suite against isolated `careiq_test` | **387 passed, zero skipped** |
| Complete component browser suite before final dependency polish | **197 passed, including 17 new cases** |
| Final affected owner-editor browser tests after dependency polish | **19 passed**, including two additional saved-profile cases; current inventory is 199 unique cases, without claiming a second complete run |
| Translation/catalog checks | **7 passed** |
| Web unit tests | **112 passed, zero skipped** |
| API/web typechecks and relevant lint | **Passed**, repeated for the final owner editor |

Coverage includes all 17 default permissions, ordinary-administrator isolation, explicit provider-grant denials, all-off management recovery, revision conflicts, owner/location narrowing and restoration, future/reopened locations, transfer and former-owner denial, inactive account rejection, notification eligibility and fresh patient-binding authority. Browser coverage includes the owner screen, grouped permissions, binding dependencies, stale saves, area/location recovery and the existing shared-frame/draft safeguards. Final review found a valid loaded profile could leave patient-account access apparently checked while its document or configuration prerequisite was disabled. The editor now initializes that dependent draft choice off and preserves it off after prerequisite restoration until explicitly selected; this makes no automatic write and preserves all other partial restrictions.

These results use controlled providers and synthetic fixtures. They do not prove an actual password, challenge, reset, delivered email or submitted QA ownership transfer.

## Final local verification

| Check | Current status |
| --- | --- |
| Read-only actual UI review for the five existing Development personas | **Passed.** Owner Home/editor defaults and real Patients, Documents and Templates returned permitted workspace data with all 17 capabilities. Both existing owner locations remain; administrator/member stay clinically restricted, clinician retains its seven-permission policy, and personal patient account access works. Owner desktop/320px captures stay white under a dark system preference with no overflow. |
| Isolated production build of the final source | **Passed.** Synthetic production identity/API settings, interview mode disabled, private separate output directory; exact original TypeScript/generated config bytes restored and the owned local services restarted successfully. No deployment occurred. |

The initial patient check reached the library but stopped on an incorrect test-only surface selector. A corrected patient-only run passed; this was a verification-script correction, not an application defect. All six exact temporary setup sessions across the five-persona check and patient retry were individually revoked. The route guard observed zero CareIQ API mutation attempts. These temporary administrative sessions prove role/UI behavior, not normal password acceptance. No QA account was transferred, reset, archived or deleted; no patient binding changed. No credentials, tokens, codes, private provider links or patient content belong in this record.

## Remaining acceptance

The [manual authentication guide](../qa-auth-manual-checks.md) retains the open normal-password/challenge, incorrect-code, branded reset receipt, reset-code/password update, old-password rejection, other-session revocation and new-sign-in checks. The earlier positive owner password/email-code report remains user-reported evidence. Invitation email-link redemption, actual mail-client rendering, second-practice acceptance and production rollout remain open. This change does not complete those items or change their required evidence.
