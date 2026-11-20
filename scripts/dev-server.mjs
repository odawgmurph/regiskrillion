// Local development server: serves public/ like Vercel's static layer and sends
// every other request to the shared handler with a file-backed SQLite database.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { Readable } from 'node:stream';
import app from '../src/worker.mjs';
import { nodeEnv, noopContext } from '../src/node-env.mjs';

const port = Number(process.env.PORT || 3051);
const root = resolve('public');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.csv': 'text/csv; charset=utf-8' };
const security = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'X-Frame-Options': 'SAMEORIGIN' };
const env = await nodeEnv({ LOCAL_DEVELOPMENT: 'true', REFERENCE_SYNC: 'false', SITE_URL: `http://localhost:${port}`, ...process.env });

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (['GET', 'HEAD'].includes(req.method) && url.pathname !== '/') {
      const file = normalize(join(root, decodeURIComponent(url.pathname)));
      if (file.startsWith(root + '/') && (await stat(file).catch(() => null))?.isFile()) {
        const body = await readFile(file);
        res.writeHead(200, { ...security, 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : body);
      }
    }
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Readable.toWeb(req);
    const request = new Request(url, { method: req.method, headers: req.headers, body, duplex: 'half' });
    const response = await app.fetch(request, env, noopContext);
    const headers = {};
    response.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(response.status, headers);
    res.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
  } catch (e) {
    console.error(e);
    res.writeHead(500).end('Internal error');
  }
}).listen(port, () => console.log(`OpenKrillion dev server on http://localhost:${port} (database: ${process.env.TURSO_DATABASE_URL ? 'Turso' : '.data/openkrillion.sqlite'})`));
