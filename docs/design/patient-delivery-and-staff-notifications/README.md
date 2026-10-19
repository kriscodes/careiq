# CareIQ patient delivery and staff notifications

Design package · October 18, 2026

Open `careiq-notifications-prototype.html` for a self-contained interactive review, or open `prototype/index.html` beside its source files. All patients, contacts, outcomes and actions are synthetic. The prototype makes no network requests and keeps its model in memory.

Included:

- Ten primary views: patient delivery, reminders, templates, staff inbox, personal preferences, staff routing, delivery setup, patient experience, recovery states and implementation handoff.
- Email/SMS request, reminder and completed-copy previews; channel review; delivery details; unknown-result recovery; staff alert detail; patient access and communication choices.
- Responsive web and phone web layouts, screenshots and local browser verification.
- Product handoff, backend design, proposed API, screen inventory, integration audit and implementation acceptance checklist.

Start with [design-handoff.md](design-handoff.md), then [backend-design.md](backend-design.md). The API proposal and data changes have not been integrated or migrated. Provider choice, sender registration, credentials, actual sending and native push remain implementation/activation work.

The canonical source baseline is `/Users/kristian/Documents/Server/CareIQ`; older project mirrors are reference material. This package preserves all application source files and synced project files.

To serve the review locally, run `python3 -m http.server 4189 --bind 127.0.0.1` in this folder and open `http://127.0.0.1:4189/prototype/`. No dependency installation is needed for the design itself.
