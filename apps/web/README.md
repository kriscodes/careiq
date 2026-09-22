# CareIQ Web

Next.js client for the patient and appointment slice. Run from the repository root with `pnpm --filter ./apps/web dev`; the local web port is 3001.

The v0.1 interview workspace uses white surfaces, restrained green accents, system fonts, patient search, day/week navigation, and centered patient/appointment dialogs. The real Clerk organization switcher selects the active practice. Dates are shown in the browser's visibly labeled local timezone.

Reviewer tools sit outside the staff application. `NEXT_PUBLIC_INTERVIEW_MODE` controls their visibility: enabled by default in development unless set to `false`; hidden in a production build unless set to `true` at build time. Rebuild after changing it. The flag only controls explanatory UI; it does not enable mock data, disable authentication, or change API writes.

The architecture panel is a static explanation, labeled “Illustrated architecture — not live telemetry.” The running application saves records through the configured API/database; use synthetic interview data.

See [v0.1 — Interview Design](../../docs/design/interview-v0.1.md), [interview architecture notes](../../docs/interview-architecture.md), and [development and deployment](../../docs/development.md) for the design contract, source-backed flow, environment variables, Clerk setup, checks, and hosting commands.
