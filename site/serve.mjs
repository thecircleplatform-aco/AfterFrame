// Static host for the AfterFrame home page.
//   node site/serve.mjs [port]
// Serves site/ and forwards /app/* to the running editor so the CTAs work.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.argv[2] ?? 3000);
const EDITOR = process.env.AFTERFRAME_APP_URL ?? 'http://localhost:5199';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
    res.writeHead(302, { Location: `${EDITOR}/${url.pathname.slice(5)}${url.search}` });
    res.end();
    return;
  }

  const rel = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(HERE, rel);
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`AfterFrame home → http://localhost:${PORT}`);
});
