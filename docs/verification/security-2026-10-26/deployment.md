# Security release deployment — October 26, 2026

Main source commit: `718d2d2081d21fad1d391f136704d1ac6f58ceec`.

[PR #15](https://github.com/kriscodes/careiq/pull/15) merged as `6274a40b10f89c1592e67f2831975d1d363d7b3a` after both workflows passed:

- [CareIQ checks](https://github.com/kriscodes/careiq/actions/runs/40442726982)
- [Readiness checks](https://github.com/kriscodes/careiq/actions/runs/40442726936)

Commit message: `fix: patch Node runtime and audit export authorization`.

Care IQ Labs workspace confirmed by the owner. API, web and marketing Node overrides updated to 22.23.4 with merge semantics, preserving all other variable keys. Render's runtime-version logs confirm the selected version. Source deployment and hosted smoke acceptance are in progress.

OAuth-secret rotation is precautionary because the credential was stored in ordinary documentation. No disclosure or misuse is established, and access/history was not investigated. Rotation was not performed and is separate from this rollout.

## API and web acceptance

- API security release [live](https://dashboard.render.com/web/srv-darjgre0tbcc73brvbmg/deploys/dep-dbg1f08ae00c73fl4b8g) on `6274a40`, completed at 03:17:50 UTC.
- Web security release [live](https://dashboard.render.com/web/srv-dau6ipqd0e5s73efagk0/deploys/dep-dbg1f08ae00c73fl4b40) on `6274a40`, completed at 03:17:39 UTC.
- Both release logs explicitly select Node 22.23.4 from NODE_VERSION.
- Fresh HTTPS checks: health200/database connected, unsigned account401, public sign-in200; gzip/deflate/br unsigned callbacks rejected415 before signature handling; health stayed200 afterward. No records or signed provider events were created.
- Marketing dependency-only update is in PR #16, source `e149c55ee83631a34bdf3ff49c15d9b3a3755cbf`, awaiting branch CI and static deploy.

## Marketing release merge

[PR #16](https://github.com/kriscodes/careiq/pull/16) passed [CareIQ checks](https://github.com/kriscodes/careiq/actions/runs/40443610449) on source `e149c55ee83631a34bdf3ff49c15d9b3a3755cbf` and merged to the marketing deployment branch as `a07c700c3a9d96c5f8bcb44e12eab34fb149dce8`.

Commit message: `fix: update marketing runtime and security dependencies`.

The update patches the old branch's runtime and dependencies while preserving all application source, site content, layout and static-export configuration. Full raw dependency audit is clean. No audit gate was weakened or bypassed.

## Final marketing acceptance

Marketing [deployment](https://dashboard.render.com/static/srv-db096cdg1s2s73d3gng0/deploys/dep-dbg1hn0473hc73f9hcv0) is live on `a07c700`, completed at 03:22:41 UTC. Hosted logs confirm Node 22.23.4 and Next 16.4.1/Turbopack. Homepage and privacy visible-text fingerprints are unchanged, and all nine referenced framework assets return 200. No new runtime errors were returned after rollout.

Both squash-merge trees exactly match the CI-tested source trees. Commit messages contain only change summaries, with no AI attribution or explanation. All requested release work is complete; credential rotation was not performed.
