# Isolated local review

Run the implemented CareIQ API, web app, marketing site and Expo web preview from this checkout. The runner uses a dedicated local PostgreSQL 18.6 container and a restricted runtime login. It does not deploy, use the original database URL or modify existing app environment files.

## Start and inspect

Select the repository-pinned **Node.js 22.23.2** before installing dependencies or starting services. The runner requires Node.js 22.13 or newer and checks the executable on your current shell's path before setup, start or restart. With nvm, run from the repository root:

```sh
nvm use
node --version
pnpm install
```

Other Node version managers should select the same version recorded in `.nvmrc` and `.node-version`. A new login shell may select a different Node version; run `nvm use` again there. Unsupported runtimes fail before starting services or stopping a restart target. Status and stop remain available for inspecting and closing existing review services.

Start Docker Desktop, then run:

```sh
pnpm local:setup
pnpm local:start
pnpm local:status
```

`local:setup` starts or creates the labeled review database, applies the full migration journal to `careiq_review` and `careiq_test`, and validates grants for the separate `careiq_review_runtime` login and creates the independent `careiq_review_audit` reader. `local:start` performs setup again safely and starts detached supervised processes. They remain running after the launching terminal closes. Start and restart return a failing exit status if a supervisor stops or a service does not become ready within the startup check. Healthy services remain running. Inspect the private logs and `local:status`, then retry `local:start` after resolving the failure.

| Surface | Local URL |
| --- | --- |
| Staff workflow preview | [Open workflow preview](http://localhost:3101/workflow-preview) |
| Protected audit review | [Open audit review](http://localhost:3101/audit) |
| Web design preview | [Open web preview](http://localhost:3101/design-preview) |
| Web authentication | [Open web sign in](http://localhost:3101/sign-in) |
| Mobile layout gallery | [Open mobile preview](http://localhost:8082/design-preview) |
| Expo web authentication | [Open mobile sign in](http://localhost:8082/sign-in) |
| Marketing | [Open marketing](http://localhost:3102) |
| API/database health | [Check API health](http://localhost:3100/health) |

The web/mobile sample galleries use synthetic data. Real authentication uses the existing Clerk **test** application. Signup creates an identity; it does not approve a founder or automatically create a practice. Only founder IDs already explicitly configured in the API environment are retained. Invitation acceptance continues to require owner confirmation and location assignments.

## Isolation and private state

Application servers bind to loopback. The database container `careiq-auth-review-db` binds only `127.0.0.1:55434`, with label `com.careiq.local-review=true` and named volume `careiq-auth-review-pgdata`. It leaves unrelated local PostgreSQL installations and occupied ports untouched.

Review uses separate ports 3100, 3101, 3102 and 8082 so existing development sessions on the usual ports remain undisturbed. Both IPv4 and IPv6 loopback are checked before starting a service.

Web and marketing use `.next-local-review` through their optional `CAREIQ_LOCAL_REVIEW_DIST_DIR` setting. Their build files and development locks remain separate from ordinary `.next` sessions.

The runtime login has no database/table ownership, superuser rights or RLS bypass. It receives the checked clinical-runtime group grant. Actor-scoped onboarding metadata and practice/location boundaries remain enforced. Marketing intake and native bearer authentication are disabled during this review; the Expo browser preview uses the exact configured browser origins. Actual iOS/Android authentication still requires device acceptance before enabling the native API policy.

Existing API/web test Clerk keys are read privately and checked for matching test applications. Production Clerk keys are refused. The original `.env` and `.env.local` files remain unchanged. Inherited shell database URLs, credentials and application configuration are excluded from app environments. The runner supplies only the isolated database URL and local public service URLs.

`.local-review/` holds private database/runtime credentials, process ownership state and logs. The directory uses mode 700; credential/state/log files use mode 600. Keep this directory ignored by Git and do not share its contents. `database.env` is an operator/migration credential; `runtime.env` is the restricted API credential; `test.env` points only to disposable `careiq_test`. `audit.env` contains the independent audit-reader credential and stable private cursor secrets. Private document objects and temporary audit export manifests stay under this directory. The runner uses a real local `clamscan` executable if present; otherwise uploads remain quarantined. See [workflow review](workflow-implementation.md) for integration boundaries.

An optional private `.local-review/owner.env` may contain only `CAREIQ_PRACTICE_CREATOR_USER_IDS`, with explicitly confirmed existing Clerk **test user IDs** separated by commas. It overrides the API's local founder list without editing original environment files. Emails and wildcards are rejected; an empty value disables local practice creation. No identity is approved automatically. Set the file to mode 600, then reload only the owned review API:

```sh
chmod 600 .local-review/owner.env
python3 scripts/local-review.py restart api
```

Resolve an email to its existing test identity before entering a user ID; this configuration requires no provider writes.

For diagnostic output, use:

```sh
python3 scripts/local-review.py status --json
```

Logs are `.local-review/api.log`, `web.log`, `marketing.log`, `mobile.log` and `setup.log`. Logs are private, but avoid pasting authentication/provider diagnostics without reviewing them.

## Stop and restart

```sh
pnpm local:stop
pnpm local:start
```

Stop verifies the recorded supervisor command, start time and process group before signaling it. An occupied port or mismatched process is never killed. The runner also verifies the database container's label, image, volume and binding before stopping that container. Stop preserves the named database volume, private credentials and logs; restarting resumes the same local data. It never removes a container or volume.

Use stop/start after dependency or environment changes. If another review operation is active, wait for it to finish before retrying. If an unmanaged process occupies a required port, close that process deliberately; the runner will not replace it. Do not use production credentials or enable native authentication merely to make a browser preview work.

`python3 scripts/local-review.py restart web` (or `api`, `marketing`, `mobile`) restarts only that matching owned supervisor, leaves the other running applications in place, and preserves the database. It applies the same ownership and occupied-port checks.
