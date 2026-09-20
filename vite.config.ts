import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const studioOverrides = (): Plugin => ({
  name: 'wire-house-studio-overrides',
  configureServer(server) {
    const target = path.resolve(process.cwd(), '.studio', 'wire-the-house-overrides.json');
    const temporary = `${target}.tmp`;
    server.middlewares.use('/__wire-house-studio-overrides', async (request, response) => {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      if (request.method === 'GET') {
        try { response.end(await readFile(target, 'utf8')); }
        catch { response.end(JSON.stringify({ version: 1, revision: 0, operations: [] })); }
        return;
      }
      if (request.method !== 'POST') { response.statusCode = 405; response.end(JSON.stringify({ error: 'Method not allowed' })); return; }
      let body = '';
      request.setEncoding('utf8');
      request.on('data', chunk => { body += chunk; if (body.length > 1_000_000) request.destroy(); });
      request.on('end', async () => {
        try {
          const parsed = JSON.parse(body) as { version?: unknown; revision?: unknown; operations?: unknown };
          if (parsed.version !== 1 || !Number.isSafeInteger(parsed.revision) || !Array.isArray(parsed.operations) || parsed.operations.length > 4096) throw new Error('Invalid bounded override payload');
          const serialized = `${JSON.stringify(parsed, null, 2)}\n`;
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(temporary, serialized, 'utf8');
          await rename(temporary, target);
          response.end(JSON.stringify({ savedAt: new Date().toISOString(), contentHash: createHash('sha256').update(serialized).digest('hex') }));
        } catch (error) {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
    });
  },
});

export default defineConfig({
  base: '/Electrical-Game/',
  cacheDir: '.vite-cache',
  plugins: [studioOverrides()],
  server: { host: '127.0.0.1', port: 5365, strictPort: true },
  preview: { host: '127.0.0.1', port: 5365, strictPort: true },
  build: { target: 'es2022', sourcemap: false },
});
