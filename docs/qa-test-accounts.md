# QA test accounts

Five dedicated Clerk development identities cover the intended owner, administrator, team member, clinician and adult-patient test personas. These labels describe test purposes; creating an identity grants no practice role, ownership or patient access. Addresses and setup status belong in the [owner-private account inventory](https://app.notion.com/p/400e97848806811fb721df0967d1ead5). Keep that page private.

## Environment and sign-in

Use [local sign-in](http://localhost:3101/sign-in) with the existing [isolated local review environment](local-review.md). Its runner requires matching Clerk test keys and a separate local database, and rejects production keys. Development identities do not carry into the live application.

Use the email-and-password form for these accounts and synthetic records throughout review. Do not copy production credentials, memberships or patient records into local tests.

## Private password handoff

Initial credentials are in the ignored local file `.local-review/test-accounts/credentials.json`. Open it privately and transfer each password directly into the owner's password manager, checking its account label and environment. Test sign-in using the saved entry.

Keep passwords, tokens, verification codes and recovery material out of Git, Notion, chat, screenshots and ordinary logs. Notion can reference the password-manager item. Treat the local file as a temporary handoff, not the long-term register. After a password reset, update the vault and any deliberately retained local handoff. Do not remove a file still needed by an ongoing authorized test.

## Aliases, inboxes and OAuth

The aliases route to one controlled inbox. They identify separate Clerk password accounts; they are not separate mailboxes or Google accounts. Google OAuth authenticates the actual Google identity selected at the provider. Do not assume it signs into an alias account or links accounts automatically.

Check each message's exact recipient and purpose. Receiving it in the shared inbox proves that delivery, not Outlook/Apple Mail rendering or a separate provider's OAuth flow.

## Establish actual authority

| Intended persona | Next setup step |
| --- | --- |
| Owner | Explicitly approve the confirmed development user ID in private local founder configuration, complete CareIQ onboarding, and assign working-location access separately. |
| Administrator | Accept the owner's invitation with the verified invited account; the owner must activate current membership and explicit locations. Administrator status alone does not establish ownership. |
| Team member | Follow invitation and owner activation with approved permissions and locations. Test pending, unassigned and revoked access. |
| Clinician | Configure the reviewed development Clerk role and permissions, allow its role key through API policy, then invite and activate it. The account label provides no permissions. |
| Adult patient | Use the patient-paperwork access manager for a separately verified adult-self binding to a synthetic patient. Matching email or organization membership does not create this grant. |

Follow the [practice access guide](practice-access-implementation.md) and [patient binding requirements](forms-studio-implementation.md#library-access-and-grant-expiry), including designated staff permissions and recent reverification. Do not bypass these flows with database membership inserts. A second-practice test requires a separately approved development owner; leave wrong-account test identities unassigned until their checks finish.

## Real email acceptance

Clerk sends verification, reset and organization-invitation emails. The application provider sends separately gated patient/staff notifications. Account creation enables neither delivery path, sender DNS, template changes nor workers.

Record environment, persona, action, time and redacted result. Distinguish component tests, real provider authentication, inbox receipt and mail-client rendering. Keep message links private. The [email guide](little-hello-emails.md) lists remaining activation and inbox acceptance work.

The [October 21 account verification record](verification/qa-accounts-2026-10-21.md) records created identities, real-provider challenge checks, actual reset receipt and remaining acceptance.
