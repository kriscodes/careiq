import { test as base, expect } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
const web = resolve(__dirname, "../..");
export const test = base.extend<{ harnessUrl: string }, { harnessServer: string }>({
  harnessServer: [async ({}, provide) => {
    const output = await mkdtemp(resolve(tmpdir(), "careiq-communications-browser-"));
    const bundle = resolve(output, "app.js");
    try {
      await build({ entryPoints: [resolve(web, "tests/browser/fixtures/communications-entry.tsx")], outfile: bundle, bundle: true, platform: "browser", jsx: "automatic", nodePaths: [resolve(web, "node_modules")], define: { "process.env.NODE_ENV": '"test"', "process.env.NEXT_PUBLIC_API_URL": "window.location.origin" }, alias: { "@clerk/nextjs": resolve(web, "tests/browser/fixtures/mock-clerk.tsx"), "next/link": resolve(web, "tests/browser/fixtures/mock-link.tsx"), "@": resolve(web, "src") }, logLevel: "silent" });
      const js = await readFile(bundle);
      const styles = await Promise.all(["globals.css", "access.css"].map(name => readFile(resolve(web, "src/app", name), "utf8")));
      styles.push(await readFile(resolve(web, "../../packages/i18n/web.css"), "utf8"));
      const workflowStyles = (await Promise.all(["workflow.css", "communications.css"].map(name => readFile(resolve(web, "src/components/workflow", name), "utf8")))).join("\n");
      const server = createServer((request, response) => {
        const path = new URL(request.url || "/", "http://localhost").pathname;
        response.setHeader("Cache-Control", "no-store");
        if (path === "/app.js") { response.setHeader("Content-Type", "text/javascript"); response.end(js); }
        else if (path === "/styles.css") { response.setHeader("Content-Type", "text/css"); response.end((styles.join("\n") + "\n" + workflowStyles).replace(/@import\s+["']tailwindcss["'];/g, "")); }
        else if (path.startsWith("/api/")) { response.statusCode = 503; response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ error: { code: "TEST_HANDLER_REQUIRED", message: "No stub API response configured." } })); }
        else { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><p style="margin:0;padding:6px;font:12px system-ui">Isolated component test · Mock identity/API · No live data</p><div id="root"></div><script src="/app.js"></script></body></html>'); }
      });
      await new Promise<void>(accept => server.listen(0, "127.0.0.1", accept));
      try { await provide(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
      finally { await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept())); }
    } finally { await rm(output, { recursive: true, force: true }); }
  }, { scope: "worker" }],
  harnessUrl: async ({ harnessServer }, provide) => provide(harnessServer),
});
export { expect };
