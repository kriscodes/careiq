import { build } from "esbuild";
import { createServer } from "node:http";
import { mkdtemp,readFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
/** Real installed Clerk React hooks, isolated reserved .invalid provider, no user browser/session. */
export async function authRuntimeHarness() {
  const web=resolve(__dirname,"../.."); const output=await mkdtemp(resolve(tmpdir(),"careiq-auth-runtime-"));
  const req=createRequire(resolve(web,"package.json"));const clerkEntry=req.resolve("@clerk/nextjs");const clerk=createRequire(clerkEntry);const reactClerk=clerk.resolve("@clerk/react");
  const bundle=resolve(output,"app.js");
  try { await build({entryPoints:[resolve(web,"tests/browser/fixtures/auth-runtime-entry.tsx")],outfile:bundle,bundle:true,platform:"browser",jsx:"automatic",nodePaths:[resolve(web,"node_modules")],define:{"process.env.NODE_ENV":'"test"'},alias:{"@clerk/nextjs":reactClerk,"next/link":resolve(web,"tests/browser/fixtures/mock-link.tsx"),"@":resolve(web,"src")},logLevel:"silent"});
    const js=await readFile(bundle);const css=(await Promise.all([resolve(web,"src/app/globals.css"),resolve(web,"src/app/access.css"),resolve(web,"../../packages/i18n/web.css")].map(path=>readFile(path,"utf8")))).join("\n").replace(/@import\s+["']tailwindcss["'];/g,"");
    const server=createServer((request,response)=>{response.setHeader("Cache-Control","no-store");if(request.url==="/app.js"){response.setHeader("Content-Type","text/javascript");response.end(js);}else if(request.url==="/styles.css"){response.setHeader("Content-Type","text/css");response.end(css);}else{response.setHeader("Content-Type","text/html");response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><p>Isolated real-SDK lifecycle test · Synthetic state · No real accounts</p><div id="root"></div><script src="/app.js"></script></body></html>');}});
    await new Promise<void>(accept=>server.listen(0,"127.0.0.1",accept));
    return {url:`http://127.0.0.1:${(server.address() as AddressInfo).port}`,close:async()=>{await new Promise<void>(accept=>server.close(()=>accept()));await rm(output,{recursive:true,force:true});}};
  } catch(error){await rm(output,{recursive:true,force:true});throw error;}
}
