// Serves api/ai/<name>.ts on a local port without the Vercel CLI, for local tests and `npm run dev`.
//
//   npm run dev:api            (reads .env if there is one; MODEL_API_KEY is optional: without it the
//                               endpoints answer with fallback:true, which is what the client must handle)
//   curl localhost:8787/api/ai/ping
//
// Vite's dev server proxies /api/ai to this port (see vite.config.ts). Uses Node's built-in TypeScript
// stripping, so run it through the npm script (it passes the flags).
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const port = Number(process.env.API_PORT ?? 8787);

// A minimal .env loader (KEY=value lines); real environment variables win.
const envFile = resolve(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const handlers = new Map();
async function handlerFor(name) {
  if (!handlers.has(name)) {
    const file = resolve(root, 'api/ai', `${name}.ts`);
    if (!existsSync(file)) return null;
    const mod = await import(pathToFileURL(file).href);
    handlers.set(name, mod.default);
  }
  return handlers.get(name);
}

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `127.0.0.1:${port}`}`);
    const match = /^\/api\/ai\/([a-z]+)\/?$/.exec(url.pathname);
    const handler = match ? await handlerFor(match[1]) : null;
    if (!handler) return send(res, 404, { error: 'not_found' });

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: hasBody ? Readable.toWeb(req) : undefined,
      duplex: 'half',
    });
    const response = await handler.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(res);
    else res.end();
  } catch (e) {
    console.error('[dev-api]', e instanceof Error ? e.name : 'error');
    if (!res.headersSent) send(res, 500, { error: 'internal', fallback: true });
    else res.end();
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`dev-api: http://127.0.0.1:${port}/api/ai/<name>  (key ${process.env.MODEL_API_KEY ? 'set' : 'not set'})`);
});
