# CareIQ working instructions

Use this existing checkout as the canonical repository: `/Users/kristian/Documents/Server/CareIQ`.
Do not clone a fresh copy, fetch or pull from GitHub as part of routine project work. Work in this directory and preserve existing uncommitted changes.
Keep all implementation documentation, design handoffs, decisions and verification records in this repo under `docs/`, with links from README or the relevant guide. Project mirrors are reference material and do not replace this checkout.
The October 6 authentication/onboarding work is local only: do not commit, push to GitHub or deploy remotely. A later explicit user instruction is required to change that scope.
Use isolated loopback databases for local review and automated database tests. Do not use the hosted development database for migration replay or destructive tests. Never commit credentials, session tokens or patient information.
Before changing an application, read its local AGENTS.md and relevant installed framework guidance. Update the existing Software Kanban records in Notion to reflect verified completion and remaining acceptance work.
