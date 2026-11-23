# Studio Insights analytics

The CareIQ web and marketing apps can send aggregate traffic to the owner-only Studio Insights dashboard. The dashboard reports them as **CareIQ Web** and **CareIQ Marketing**. Both apps use the bundled collector in `packages/studio-insights/collector.ts`.

## Measurement

- **CareIQ Web** measures visits to the app entry route `/`, including direct and signed-in openings. It emits a pageview with a fixed route and no referrer or campaign. Clinical routes, in-app actions, account and practice identifiers, and patient data are outside collection.
- **CareIQ Marketing** measures visits to `/` and `/research/`, visible active time, and the 25%, 50%, 75%, and 100% scroll milestones. Entry sources and campaigns use fixed categories. Form values and submissions stay outside analytics. The privacy page is excluded.
- Browser IDs rotate at midnight Pacific time. Visit IDs expire after 30 minutes of inactivity or a change of Pacific date. Browser storage and visit identifiers are local to each origin. Requests omit credentials, redirects, and the browser referrer. No third-party script runs in either app.
- DNT and GPC stop collection. Use `/analytics-privacy` on the web app and **Website analytics** on the marketing privacy page to opt out on each origin. Opt-out clears that site's local identifiers. The collector hashes identifiers before storing events and expires event records after 180 days.

## Deployment

1. Deploy the Studio Insights API/dashboard support first. It registers the CareIQ hosts for each environment and rejects unrecognized paths and event types.
2. Set `NEXT_PUBLIC_STUDIO_INSIGHTS_ORIGIN` at **build time** for both CareIQ frontends. A blank or unrecognized value disables the integration. Set staging builds to `https://kristian-salmeron-api-staging.onrender.com` and production builds to `https://analytics.kristiansalmeron.com`. Rebuild after changing the setting. Each build can send only from its matching published hosts. Local and preview hosts are excluded.
3. In a browser on the staging domains, visit each entry page. Check that the requests go only to the staging collector, return HTTP 204, and carry the expected fixed site and route. Check that the two site filters and All sites report those visits.
4. Check that a clinical route and both preferences pages generate no analytics. Enable the site opt-outs and revisit both measured entry pages. Confirm requests stop, then restore the browser preferences if desired.

Clear the environment variable and rebuild to turn off either client. Existing Workspace routes and intake forms do not depend on delivery.
