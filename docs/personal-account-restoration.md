# Restore a personally archived account

Archive disables application access immediately through local account state, then confirms the identity-provider ban. The ban revokes provider sessions and prevents new sign-ins. Deletion is a separate pending request. Neither operation erases clinical or audit records.

Only a trusted operator can restore an account; there is no public or practice-administrator restoration endpoint. First verify the person's identity through the approved support process. Review the local archive and provider account, confirm the ban belongs to that archive, and rule out an unrelated moderation, security or directory restriction. Record that review in a support reference. Restoration does not grant practice memberships, roles, locations or patient access.

Using the API deployment's matching database and provider environment, run from `apps/api`:

```sh
pnpm exec tsx src/account-restore.ts --user-id user_REVIEWEDID --reference support:REVIEWED_REFERENCE --confirm RESTORE --environment development
```

Use `production` only for an explicitly reviewed production restoration. The command checks the actual provider instance environment and the restricted database release before changing the account. It prints no user identifiers or credentials. Do not run this command to test existing QA identities.

The service first records `restoring`, which continues to deny application access. It then confirms provider unban before setting `active` and appending restoration evidence. A provider or database failure leaves access denied; review the state and retry the same reviewed restoration. Restored users must sign in again because the previous sessions were revoked. Their current practice and patient permissions are checked normally.

If an archive or restoration was interrupted, do not edit a local flag to skip the provider step. The service is resumable. A later unrelated provider ban must not be removed merely because an older archive exists. Any future deletion fulfillment must recheck every owned practice and all record-retention requirements immediately before acting.
