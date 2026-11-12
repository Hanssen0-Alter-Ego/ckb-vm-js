import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><title>CKB WASM Worker integration</title>');
      return;
    }
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep) && file !== root) throw new Error('Invalid path');
    const body = await readFile(file);
    // Deliberately no COOP/COEP headers: this test proves the non-isolated path.
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}).listen(Number(process.env.PORT ?? 4178), '127.0.0.1');
