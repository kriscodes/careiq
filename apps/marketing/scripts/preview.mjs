// Local-only preview of the actual exported files, with real 404 responses.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, extname } from 'node:path';
const root = fileURLToPath(new URL('../out/', import.meta.url));
const port = Number(process.env.MARKETING_PREVIEW_PORT ?? 3002);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid MARKETING_PREVIEW_PORT');
await stat(resolve(root, 'index.html')).catch(() => { throw new Error('Build the marketing export before previewing it.'); });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain', '.xml': 'application/xml', '.ico': 'image/x-icon' };
createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
  let file;
  try {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    file = resolve(root, '.' + pathname);
    if (relative(root, file).startsWith('..')) throw new Error('Invalid path');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    await stat(file);
  } catch {
    file = resolve(root, '404.html');
    res.statusCode = 404;
  }
  try {
    const data = await readFile(file);
    res.setHeader('Content-Type', (mime[extname(file)] ?? 'application/octet-stream') + '; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.statusCode = 500; res.end('Unable to read exported page.'); }
}).listen(port, '127.0.0.1', () => console.log(`CareIQ marketing export: http://127.0.0.1:${port}`));
