# Release process

## Source of truth

CareIQ starts its versioned SDLC at **0.1.0**. The root `package.json` is the canonical product version. The API, web, marketing and shared workspace package versions follow it while this repository uses one product release number. Database migrations retain their own ordered identifiers; `/api/v1` is the API contract version, not the product release number.

Keep these records together:

| Record | Purpose |
| --- | --- |
| `CHANGELOG.md` | Newest-first version index and an Unreleased section for completed changes. |
| `docs/releases/X.Y.Z.md` | Detailed scope, evidence, known limitations and deployment notes for one version. |
| Git tag `vX.Y.Z` and GitHub release | Fixed source snapshot and a short summary linking to the detailed note. |
| Notion: Software Project → Version Notes | One short blurb per version, with date, stage and links to the repository notes and GitHub release. |

Notion is the readable index. Keep technical details and validation evidence in the repository so they can be reviewed with the code. Release status and deployment status are separate facts.

## Version numbering

- **Patch — `0.1.1`:** compatible fixes, small refinements, dependency updates or documentation corrections to a released baseline.
- **Minor — `0.2.0`:** a meaningful new workflow or capability. During `0.x`, document any breaking changes explicitly and use a minor bump for them.
- **Major — `1.0.0`:** an explicitly agreed stable product milestone. A version number alone does not satisfy pilot, security or real-data launch requirements. After 1.0, use major versions for incompatible contract changes.
- Use a prerelease such as `0.2.0-rc.1` when a candidate needs a distinct source snapshot before acceptance. Mark early demo/candidate releases as prereleases in GitHub where appropriate.
- Never reuse, move or overwrite a published version tag. Record a correction in the next release and link back if needed.

## Working cadence

1. **As work merges:** add concise completed changes to Unreleased and link relevant PRs/evidence. Keep proposed work in the backlog.
2. **Once a week:** review interview feedback, merged work and open defects; decide whether there is a useful increment to release. This is a working convention, not a scheduled automation or promise to ship weekly.
3. **At a meaningful demo or delivery milestone:** complete the checklist and cut a version. Release urgent fixes when ready instead of waiting for the weekly review.
4. **On the same day as release:** add the Notion blurb and verified repository links. Update deployment evidence only after checking the actual environment.
5. **After feedback:** turn findings into scoped backlog items for the next cycle.

## Release checklist

- [ ] Choose the scope, version, release stage and acceptance criteria; resolve release blockers or state the limitations allowed for that stage.
- [ ] Implement and review changes through a pull request; record acceptance evidence.
- [ ] Update the root and workspace package versions together and refresh affected lockfiles if necessary.
- [ ] Copy [`releases/TEMPLATE.md`](releases/TEMPLATE.md) to `releases/X.Y.Z.md`; write the summary, changes, evidence, limitations and deployment/recovery impact.
- [ ] Move completed Unreleased items into the dated changelog entry; leave a fresh Unreleased section and update the README's current release link.
- [ ] Run the required repository CI and relevant acceptance checks. Database tests and migration rehearsal use a disposable database. Record skipped checks and why; do not report inherited evidence as newly run.
- [ ] Merge the reviewed release PR into `main` after the checks pass. Confirm the target commit and that no unrelated changes entered the release.
- [ ] Create an annotated `vX.Y.Z` tag on the exact merged release commit and push that tag. Publish a GitHub release with the same version and a link to the detailed notes at that tag.
- [ ] Add one row to Notion **Software Project → Version Notes**, newest first: version, date, stage, one- or two-sentence blurb, full notes and GitHub release links. Verify both links.
- [ ] If deploying, follow the documented migration/backup steps and verify each component and its commit. Record hosted smoke results and remaining controls separately.

## Notion blurb pattern

> **vX.Y.Z — Release name** · YYYY-MM-DD · Stage. One sentence describing the user-visible outcome. One sentence stating a material limitation when needed. **Full notes:** link to `docs/releases/X.Y.Z.md` at the release tag. **Release:** link to the GitHub release.

Keep credentials, personal data and private operational details out of public release notes.
