import { expect, test } from "@playwright/test";

/** Production Next server, reserved .invalid synthetic live-shaped keys, HTTP only; no hosted auth. */
test("production rejects reviewer pages and static assets before Clerk, including encoded aliases", async ({ request }) => {
  for (const path of ["/design-preview", "/workflow-preview", "/workflow%2Dpreview", "/workflow-preview%2Findex.html", "/design-preview/index.html", "/design-preview/web-design-board.png", "/design-preview/ios-design-board.png", "/design-preview/android-design-board.png", "/design-preview%2Findex.html", "/design%2Dpreview/index.html"]) {
    const response = await request.get(path, { headers: { accept: "application/json" }, maxRedirects: 0 });
    expect(response.status(), path).toBe(404);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  }
});
test("production HTML carries matching Clerk/Next nonce directives and safe transport headers", async ({ request }) => {
  const nonces: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await request.get("/sign-in", { headers: { accept: "application/json" }, maxRedirects: 0 });
    expect(response.status()).toBe(200);
    const headers = response.headers();
    const csp = headers["content-security-policy"];
    const nonce = csp?.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("https://api.release.invalid");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["cache-control"]).toContain("no-store");
    const html = await response.text();
    expect(html).toContain(`nonce="${nonce}"`);
    expect(html).not.toContain("Interview reviewer");
    nonces.push(nonce!);
  }
  expect(nonces[0]).not.toBe(nonces[1]);
});
test("missing owner-supplied mobile association documents return 404 without an auth handshake", async ({ request }) => {
  for (const path of ["/.well-known/apple-app-site-association", "/.well-known/assetlinks.json"]) {
    const response = await request.get(path, { headers: { accept: "application/json" }, maxRedirects: 0 });
    expect(response.status()).toBe(404);
    expect(response.headers()["location"]).toBeUndefined();
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
});
