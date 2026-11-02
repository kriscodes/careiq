# Communication Choices loading fix — November 2, 2026

## Result

Patient Delivery → Communication Choices opens its patient selector immediately when no patient is selected. Refreshing that empty state remains idle. Selecting a patient loads their recorded communication choices; failed reads can be retried with Refresh. Clearing the selection removes the prior patient's choices without leaving a loading indicator behind.

## Cause and change

The section effect queued `setLoading(true)` in a microtask and then started an async function. In the Contacts section with an empty patient selection, that function performed no awaited operation, so its `finally` set loading to false synchronously. The queued microtask then set it back to true. The patient selector stayed hidden, and Refresh stayed disabled although no request was running.

The effect now determines whether the current section actually needs a request. An empty Contacts selection queues an idle loading state and returns without starting the request function. Real requests keep the existing abort checks, error handling, and final loading cleanup. Switching tabs aborts an earlier preferences read and prevents its late result from replacing the current section.

No API paths, permissions, contact records, delivery behavior, or loading visuals changed.

## Verification

All checks used synthetic records and loopback fixtures with Node 22.23.4 and Chrome.

- Before the fix, the new empty-selection regression failed: the Choose A Patient selector never appeared after opening Communication Choices.
- After the fix, the complete communications browser file passed: **10 tests**. Its three new regressions cover opening/refreshing without a patient, retrying a failed read and clearing the selection, and leaving the section while a patient read is pending.
- Web TypeScript check passed with incremental writes disabled.

Commands from `apps/web` with the repository's pinned Node directory on `PATH`:

```sh
PLAYWRIGHT_CHANNEL=chrome node node_modules/@playwright/test/cli.js test tests/browser/communications.spec.ts --project=components --output=/private/tmp/careiq-contacts-after-results
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

Local acceptance: open Patient Delivery, select Communication Choices, choose a patient, and return the selector to Choose A Patient. The selector and Refresh control should remain available whenever no read is pending.
