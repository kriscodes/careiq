# Proposed backup and retention procedure

Status: proposal for owner and California healthcare counsel review, October 3, 2026. No retention purge, backup schedule, storage purchase, legal hold, or account upgrade has been enabled by this document.

## Scope and decisions received

CareIQ will initially serve practices in greater Los Angeles, California, including practices treating minors. Real patient operations will use identifiable information. Patient identities linked to appointments and care workflows are to be treated as protected health information (PHI); synthetic records remain appropriate for development and demonstrations. See [HHS's definition of protected information](https://www.hhs.gov/hipaa/for-professionals/privacy/laws-regulations/index.html).

The owner confirmed `kristian@careiqlabs.com` is set up and tested. Kristian is the initial operational owner and intended interview/privacy contact. The owner signed back into Render and Clerk, but the task's fresh browser check still failed during app-server initialization. Production settings remain unverified.

A universal six-year maximum is not adopted. Keep application records according to their category and the practice's obligations; rotate disaster-recovery backups on a separate short schedule. Legal holds and longer applicable requirements prevent scheduled deletion. This proposal must be validated for each customer's provider type, payer obligations, custody agreement and record categories before automated deletion is activated.

## Legal baseline for the initial market

- California physicians must maintain adequate service records for at least seven years after the patient's last service. This is a minimum, with a service-based clock, not six years after a database row was created. [Business and Professions Code 2266](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=2266)
- For records covered by Medi-Cal's rule, the ten-year clock runs from the latest of the plan/provider contract's final date, audit completion, or service date. A generic ten years after an appointment can therefore still be too short. [Welfare and Institutions Code 14124.1](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=WIC&sectionNum=14124.1.)
- Minor-related rules vary by profession and setting. For example, California's marriage-and-family-therapist rule requires seven years after a minor turns 18; it is not a universal rule for every physician or appointment record. [Board of Behavioral Sciences statutes, section 4980.49](https://bbs.ca.gov/pdf/publications/lawsregs.pdf)
- HIPAA's six-year documentation rule applies to required compliance documentation, measured from creation or last effective date, whichever is later. It does not establish a universal medical-record retention period. [HHS audit protocol, 164.316(b)(2)(i)](https://www.hhs.gov/hipaa/for-professionals/compliance-enforcement/audit/protocol/index.html), [HHS medical-record retention FAQ](https://www.hhs.gov/hipaa/for-professionals/faq/does-hipaa-require-covered-entities-to-keep-medical-records-for-any-period/index.html)

CareIQ's copy is not automatically the practice's complete medical chart. Identify the system of record, what CareIQ holds on the practice's behalf, who handles access/export, and the applicable schedule in the customer agreement and business associate agreement (BAA). HHS generally expects a business associate to return or destroy PHI when the BAA ends where feasible, with continuing protection when retention is legally required or destruction is infeasible. Do not use a ten-year default as a reason to keep every departing customer's PHI against its lawful instructions. [HHS guidance on cloud-provider termination](https://www.hhs.gov/hipaa/for-professionals/faq/do-the-hipaa-rules-require-a-csp-to-maintain-ephi-for-some-period-of-time-beyond-when-it-has-finished-providing-services-to-a-covered-entity-or-business-associate/index.html)

## Proposed schedule

These are proposed CareIQ defaults, not a representation that every period is legally required or sufficient.

| Data class | Proposed rule | Deletion conditions |
| --- | --- | --- |
| Patient/service records CareIQ is contracted to retain | Adults: ten years after last service as a conservative initial default. Minors: the later of that date or the 25th birthday. | Extend for applicable payer/contract dates, profession-specific rules and legal holds. Review with the practice/counsel; no unconditional ten-year ceiling. Handle return/export and deletion on termination under the BAA. |
| Required HIPAA policies, risk assessments and other required documentation | At least six years after creation or last effective date, whichever is later. | Preserve longer if a hold or another applicable rule requires it. |
| Clinical access/change audit metadata | Proposed six years from the event, subject to a longer practice contract or legal hold. | This is a company policy choice for these logs, not a claim HIPAA requires every technical log to be kept six years. Keep the audit trail protected and interpretable after record export/deletion. |
| Technical diagnostic logs with no PHI or secrets | Thirty days initially; retain specific incident evidence separately as required. | Verify each provider's actual retention and redaction. No patient names, contact details, appointment reasons, tokens or request bodies in hosting logs. |
| Marketing interview requests and related correspondence | Twelve months after last meaningful contact, or earlier verified deletion where appropriate. | Review monthly. Preserve only narrowly necessary evidence of a request, dispute or obligation. No patient data belongs in this intake. |
| Disaster-recovery backups | Daily encrypted independent copy, expiring on a rolling 35-day schedule, plus available native point-in-time recovery. | Document provider expiration behavior and any hold exceptions. Backups are not the long-term record archive. |
| Clinical retry keys | Retain with the applicable record/retry contract until a reviewed deletion design exists. | Do not purge blindly: a removed key can permit an old request to create a duplicate. |

Do not calculate a patient's retention deadline using `created_at`, `updated_at`, the last CareIQ login, or the latest appointment row alone. CareIQ currently lacks a complete source of last service, minor status, payer contract/audit completion, hold state and approved retention deadlines. These must be obtained from a reliable practice/system-of-record process before automation. An explicit practice-approved `retain_until` may avoid collecting an otherwise unnecessary date of birth. Missing information means manual review and no automatic deletion, not an invented deadline.

## Backup and recovery procedure

1. Verify the actual production database identity, Render workspace/compute plan, earliest recoverable timestamp, last successful backup and current BAA/HIPAA status. Record evidence without credentials or patient data. Render's paid native recovery window is three days on Hobby and seven on Pro or higher; provider-stored logical exports expire after seven days. Free compute has no managed recovery. [Render backup documentation](https://render.com/docs/postgresql-backups)
2. Before real PHI, verify an appropriate signed BAA and enabled HIPAA workspace for Render, and applicable agreements/configuration for any backup provider. Render currently requires Scale or Enterprise for HIPAA workspaces; the app is not made compliant merely by enabling that option. Keep PHI out of static assets, builds, service names and hosting logs. No plan upgrade or contract signature is authorized by this proposal. [Render HIPAA requirements](https://render.com/docs/hipaa-compliance)
3. Preserve native point-in-time recovery and add daily full encrypted exports to separately controlled storage. Use separate credentials, limited backup permissions, encryption-key recovery and protection against malicious deletion. Avoid placing real exports on a developer laptop or in Git. Render documents [exports to S3](https://render.com/docs/backup-postgresql-to-s3); its example requires a production permissions review.
4. Use a provider-supported full-database backup/export identity. The API login is deliberately unable to read audit tables and is subject to forced RLS; it is not a complete-backup credential. Never disable application RLS or use a row-filtered dump as proof of a complete backup. [PostgreSQL pg_dump behavior](https://www.postgresql.org/docs/current/app-pgdump.html)
5. Check backup completion daily and alert Kristian on failure or an unexpectedly stale copy. Keep a small manifest of timestamp, database identity, schema revision, byte count, checksum and restore-test result; do not include PHI. Thirty-five days is a proposed independently stored recovery window, not a Render setting already in force.
6. Restore into a separate protected environment before the production security migration, at least quarterly afterward, and after material backup/schema changes. Disable outgoing integrations. Validate tables, tenant totals, audit records, retry metadata, RLS, effective runtime grants and representative synthetic workflows. Preserve an access-controlled test report and remove the temporary restore when complete.
7. Measure recovery time and newest recoverable transaction before promising customers an SLA. A daily independent copy alone can lose up to 24 hours of data if it is the only surviving recovery path and every scheduled backup completes successfully; failed or stale backups can extend that loss. Native PITR can reduce that loss when available, but Render does not allow a recovery target within the latest ten minutes.

CISA recommends encrypted offline/isolated backups and regular restoration tests. The daily/35-day/quarterly numbers above are CareIQ proposals, not CISA or HIPAA mandates. [CISA ransomware guidance](https://www.cisa.gov/stopransomware/ransomware-guide)

For comparison, Azure PostgreSQL separates an operational backup window of up to 35 days from separately configured long-term backup retention of up to ten years. These are product capabilities, not legal mandates or settings configured for CareIQ. [Microsoft backup overview](https://learn.microsoft.com/en-us/azure/backup/backup-azure-database-postgresql-flex-overview)

Keep retained medical records available in the live system or a usable protected archive for their approved lifetime. Rolling backup expiration does not authorize deleting those original records. Conversely, keeping every full database snapshot for six years would unnecessarily extend the lifetime of deleted records and other short-lived information.

## Review, holds, offboarding and deletion

Kristian initially reviews interview submissions and the contact inbox each business day; the form does not send an automatic notification. This is a proposed manual operating procedure, not an automation created by this document. Record privacy requests, verify authority proportionately, and refer clinical-record decisions to the practice's authorized contact. Do not ask people to email patient records to the marketing inbox.

Before a clinical deletion, confirm the record classification, approved deadline, practice authority, access/export obligations and absence of legal, audit or investigation holds. Place/release holds through a recorded authorized process. Review deadlines when law, contract, provider type or payer changes; do not silently extend all data forever.

Offboarding must provide a secure, usable export and confirm the receiving custodian before deleting the production copy under the contract/BAA. Do not treat export as proof of the customer's long-term custody until receipt and completeness are checked. [SimplePractice's published offboarding flow](https://support.simplepractice.com/hc/en-us/articles/11462507018253-Canceling-your-SimplePractice-account) similarly requires attention to export before account deletion; that company's process does not determine CareIQ's legal retention periods.

Approved deletions must cover production data, caches, exports and applicable correspondence. Restricted recovery copies expire under the documented backup schedule; disclose any lawful delayed backup erasure rather than claiming immediate erasure everywhere. Maintain a minimal protected deletion/hold ledger independently of the database being restored, or obtain its authoritative latest state from a separate protected source. Never rely only on the old snapshot's copy, which omits subsequent deletions and holds. Replay the current ledger before reopening access. The ledger must survive the maximum backup window; keeping a timestamp and scoped internal reference does not require keeping the deleted patient payload.

## Implementation and launch status

- Mailbox setup/testing: confirmed by owner.
- Market and PHI scope: California/greater Los Angeles, including minors, real identifiable patient operations.
- Periods and operational schedule: proposed, awaiting adoption and customer/legal validation.
- Backup plan, BAA status, production restore and account settings: not verified or changed.
- Automatic retention deletion, legal-hold workflow, complete customer export and restore/deletion replay: not implemented by the security release.
- Interview intake/indexing: remain disabled until the separate launch checklist is completed.

Review this procedure with California healthcare counsel and the first customer before real-patient onboarding, especially provider-specific/minor rules, Medi-Cal timing and CareIQ's custodian responsibilities. Then implement and test the approved lifecycle rather than treating this document as evidence of enforcement. See [security rollout status](deployment/security-release-status.md) and [hardening runbook](security-hardening.md).
