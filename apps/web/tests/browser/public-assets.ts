import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const types: Record<string, string> = { ".woff2": "font/woff2", ".png": "image/png", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8" };
/** Serve only checked-in brand files; missing assets must never receive the HTML shell. */
export async function serveBrandAsset(request: IncomingMessage, response: ServerResponse, web: string): Promise<boolean> {
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  if (!pathname.startsWith("/brand/")) return false;
  response.setHeader("X-Content-Type-Options", "nosniff");
  try {
    const root = await realpath(resolve(web, "public/brand"));
    const candidate = resolve(root, decodeURIComponent(pathname.slice("/brand/".length)));
    if (!candidate.startsWith(root + sep)) throw new Error("Outside brand directory");
    const file = await realpath(candidate);
    const type = types[extname(file)];
    if (!file.startsWith(root + sep) || !type) throw new Error("Unsupported asset");
    const bytes = await readFile(file);
    response.setHeader("Content-Type", type);
    response.end(bytes);
  } catch {
    response.statusCode = 404;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end("Brand asset not found");
  }
  return true;
}

export const authProviderFixtureScript = '<script>window.__careiqAuthProviderConfig = new URLSearchParams(location.search).get("providers") || "";</script>';
