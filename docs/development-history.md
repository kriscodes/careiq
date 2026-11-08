# Development history and earlier verification

This page preserves the dated implementation references and local-session context previously listed in the repository README. It is an archive of those records, not a statement of current deployment or acceptance.

For repository scope and the last documented hosted verification, start with the [current README](../README.md#current-status) and the [November 2 release report](verification/e2e-release-2026-11-02.md). A result applies to the revision, environment, and checks identified in its source record.

## Dated implementation and review records

| Date / context              | Record and scope                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| October 3, 2026             | [v0.1.0 interview baseline](releases/0.1.0.md), the initial tagged synthetic/demo release. Subsequent implementation is distinct from this tag.                                                                                                                                                                                       |
| October 16–17, 2026         | [Workflow verification](verification/workflow/verification.md), [Forms Studio and patient paperwork](forms-studio-implementation.md), and [local security, login stability, and capacity evidence](verification/security-load-2026-10-17/README.md). These records describe their original local scope and remaining activation work. |
| October 18, 2026            | [Mobile separation and recovery](mobile-separation.md), [notification verification](verification/notifications-2026-10-18/README.md), and [PR #10 integration review](verification/pr-10-main-2026-10-18/README.md). Statements about uncommitted/unpushed work refer to the original review sessions.                                |
| October 21, 2026            | [Little hello authentication and email verification](verification/little-hello-2026-10-21/README.md), with its recorded local checks and remaining provider/inbox acceptance.                                                                                                                                                         |
| October 26, 2026            | [Main security review](verification/security-2026-10-26/README.md), linked with the [hardening guide](security-hardening.md) and [deployment/owner-action history](deployment/security-release-status.md).                                                                                                                            |
| November 2, 2026            | [Manager team activity](verification/manager-team-activity-2026-11-02.md), [UI capitalization](verification/ui-capitalization-2026-11-02.md), [patient-row hover spacing](verification/patient-row-spacing-2026-11-02.md), and [shared loading indicators](verification/shared-loading-2026-11-02.md).                                |
| November 2, 2026 deployment | [End-to-end release verification](verification/e2e-release-2026-11-02.md), which records API/web promotion and public smoke checks while retaining protected-workflow and other acceptance limits.                                                                                                                                    |

The earlier [interview design](design/interview-v0.1.md), [authentication/onboarding design](auth-onboarding.md), [notification designs](design/patient-delivery-and-staff-notifications/design-handoff.md), and [PR #11 check-repair record](verification/pr-11-ci/README.md) remain available as supporting context.

## Historical local-session instructions

Earlier README text directed ongoing development sessions to a canonical checkout at `/Users/kristian/Documents/Server/CareIQ` and asked those sessions not to create fresh GitHub checkouts. Those were working-session instructions for the existing local environment. They are not a portable setup path for new contributors.

The same notes said that no GitHub push, deployment, or hosted change had been performed for particular local implementation/review tasks. The October 18 PR #10 integration note also said the merge remained uncommitted/unpushed at the owner's request. These are historical statements about those tasks, not a continuing description of the repository or hosted services.

The old README's environment section said production infrastructure would be introduced later. Later deployment records must be consulted for the actual hosted state; this earlier sentence must not be used as current deployment evidence.

Automation working in the repository must follow the applicable [working instructions](../AGENTS.md). For portable setup, use [Run locally](../README.md#run-locally) and the [development guide](development.md).

## Historical preview and activation context

The [synthetic workflow preview](http://localhost:3101/workflow-preview) is a loopback URL available only after starting the isolated local review environment. It is not a public hosted demo.

The original workflow and Forms Studio notes distinguished local implementation from delivery, scanning, storage, provider, and physical-device activation. Native mobile source was separated from the active checkout on October 18 and preserved for a future repository. Current implementation and activation boundaries are documented in the linked guides rather than inferred from historical test counts.

## Original README reference index

The links below preserve the original README's unique reference targets. Paths have been rebased for this file's location under `docs/`.

- [main security review](verification/security-2026-10-26/README.md)
- [hardening guide](security-hardening.md)
- [release status and owner actions](deployment/security-release-status.md)
- [implementation and audit coverage](manager-insurance-implementation.md)
- [scope, permissions and verification](manager-team-activity.md)
- [November 2 review, exact change inventory and local checklist](verification/ui-capitalization-2026-11-02.md)
- [desktop and phone review](verification/patient-row-spacing-2026-11-02.md)
- [coverage, verification and local checklist](verification/shared-loading-2026-11-02.md)
- [deployment and verification results](verification/e2e-release-2026-11-02.md)
- [v0.1.0 — Interview baseline](releases/0.1.0.md)
- [version history](../CHANGELOG.md)
- [release process](releasing.md)
- [workflow implementation and review guide](workflow-implementation.md)
- [runtime API contract](design/workflow/runtime-contract.md)
- [OpenAPI payload/response definitions](api/workflow.openapi.json)
- [interactive workflow preview](http://localhost:3101/workflow-preview)
- [Forms Studio and patient paperwork implementation](forms-studio-implementation.md)
- [security checklist](security/owner-security-checklist.md)
- [interview design](design/interview-v0.1.md)
- [authentication/onboarding guide](auth-onboarding.md)
- [mobile separation and recovery](mobile-separation.md)
- [Little hello authentication](little-hello-authentication.md)
- [email implementation](little-hello-emails.md)
- [October 21 verification record](verification/little-hello-2026-10-21/README.md)
- [web, iOS and Android designs](design/auth-onboarding/design-handoff.md)
- [interactive prototype](design/auth-onboarding/prototype.html)
- [local review guide](local-review.md)
- [`docs/development.md`](development.md)
- [`docs/decisions`](decisions)
- [Patient delivery and staff notification implementation](notifications-implementation.md)
- [Notification verification record](verification/notifications-2026-10-18/README.md)
- [PR #11 check repairs](verification/pr-11-ci/README.md)
- [Patient delivery and staff notification designs](design/patient-delivery-and-staff-notifications/design-handoff.md)
- [Public marketing website](marketing.md)
- [Marketing verification](marketing-verification.md)
- [Product Vision](product-vision.md)
- [Architecture](architecture.md)
- [Interview architecture notes](interview-architecture.md)
- [Production-readiness status](production-readiness.md)
- [Web production checks](web-production-readiness.md)
- [API production checks](api-production-release.md)
- [Mobile production checks](mobile-production-readiness.md)
- [Interface languages and dropdown styling](localization.md)
- [Mobile development](mobile-development.md)
- [Practice/location access](practice-access-implementation.md)
- [Verification record](verification.md)
- [security, login stability and capacity evidence](verification/security-load-2026-10-17/README.md)
- [PR #10 conflict-resolution verification](verification/pr-10-main-2026-10-18/README.md)
