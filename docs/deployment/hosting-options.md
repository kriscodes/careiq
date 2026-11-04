# Hosting and backup decision — October 3, 2026

Owner decision: keep CareIQ restricted to synthetic/demo data while comparing costs. No paid upgrade, AWS account, storage purchase or BAA signature was authorized or completed.

| Option | Cost evidence | Operating tradeoff |
| --- | --- | --- |
| Current Render Hobby | Existing compute/storage charges; no new workspace upgrade | Suitable for the current synthetic demo. HIPAA is disabled; not approved for real PHI. |
| Render Scale with HIPAA | Dashboard quoted $499/month workspace fee, plus compute; HIPAA adds 20% to usage charges | Least infrastructure migration work. Requires signed BAA, HIPAA enablement and broader operating controls. The workspace fee is not the all-in bill. |
| AWS eligible services | Usage-based EC2/RDS/S3/networking/security/monitoring charges; BAA acceptance through Artifact carries no additional agreement fee | Can avoid Render's fixed Scale subscription, but requires infrastructure design and maintenance. No validated all-in monthly quote yet. Include redundancy, backup storage, KMS, monitoring, egress and support; do not compare only a small VM price with managed hosting. |
| DigitalOcean eligible products | Usage-priced eligible compute/storage; BAA and final configuration need review | Droplets and Spaces are listed as eligible, but managed databases and App Platform are not on the published eligible-products list reviewed. Self-managing PostgreSQL adds substantial work for a solo operator. No all-in quote or migration approval. |

Sources: [Render HIPAA requirements](https://render.com/docs/hipaa-compliance), [Render pricing](https://render.com/pricing), [AWS HIPAA](https://aws.amazon.com/compliance/hipaa-compliance/), [AWS eligible services](https://aws.amazon.com/compliance/hipaa-eligible-services-reference/), [AWS Artifact BAA process](https://aws.amazon.com/blogs/security/accept-a-baa-with-aws-for-all-accounts-in-your-organization/), [DigitalOcean HIPAA scope](https://www.digitalocean.com/trust/hipaa-at-do).

Recommendation: retain the current demo deployment while obtaining an AWS calculator estimate for the required availability and operating model. Compare the cost of running it safely, including operator time, with Render's fixed fee. No option alone makes the application compliant. Do not use AWS Lightsail as a presumed PHI shortcut; it was not on the eligible-services list reviewed.

## Independent backups

AWS S3 is a candidate separate provider. The owner does not currently have an AWS account. Before provisioning, review the region-specific calculator estimate and approve the account/budget. S3 charges separately for stored bytes, requests, retrieval/transfer and optional features; key management, monitoring and the job that creates backups also contribute. There is no verified dollar quote for CareIQ's backup configuration yet. [S3 pricing](https://aws.amazon.com/s3/pricing/)

Size the rolling storage as approximately 35 daily compressed full exports, plus any versions/hold exceptions, and measure actual growth. Do not use long-minimum-duration archive classes for a 35-day rotation without accounting for their minimum-storage charges and recovery delay. Native Render exports alone are not an independent backup.

The configuration still needs a dedicated backup identity, private encrypted storage, separate key recovery, least-privilege write permissions, lifecycle rules covering noncurrent versions, stale-copy/failure alerts, and a restore from that exact storage. No such configuration is currently claimed.

## Authentication costs and agreements

Clerk's published pricing places HIPAA BAAs in its Enterprise offering (custom quote). Determine what information Clerk actually receives and which agreements are applicable; staff-only authentication is not permission to place PHI in profile fields or organization metadata. Evaluate this cost before choosing the final PHI architecture. [Clerk pricing](https://clerk.com/pricing), [Clerk security](https://clerk.com/security)
