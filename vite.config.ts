import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const waterCanvasReadbackHint = (): Plugin => ({
  name: 'wire-house-water-canvas-readback-hint',
  enforce: 'pre',
  transform(source, id) {
    if (!id.replaceAll('\\', '/').split('?')[0].endsWith('/src/generated/room-water-runtime.js')) return null;
    // Water Pro reads eight 2048px masks from these temporary canvases.
    // Hint Chrome before the first readback; keep the vendor source untouched.
    const original = 'n=p.getContext("2d");if(!n)throw new Error("createSprayTexture: 2D canvas unavailable")';
    if (source.split(original).length !== 2) throw new Error('Water Pro canvas readback call changed; review the integration');
    return source.replace(original, 'n=p.getContext("2d",{willReadFrequently:!0});if(!n)throw new Error("createSprayTexture: 2D canvas unavailable")');
  },
});

const studioOverrides = (): Plugin => ({
  name: 'wire-house-studio-overrides',
  configureServer(server) {
    server.middlewares.use('/__wire-house-studio-overrides', async (request, response) => {
      const entrypoint = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.get('entrypoint');
      const target = path.resolve(process.cwd(), '.studio', entrypoint === 'mansion-construction' ? 'mansion-studio-overrides.json' : 'wire-the-house-overrides.json');
      const temporary = `${target}.tmp`;
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

const levelEditorDocument = (): Plugin => ({
  name: 'wire-house-level-editor-document',
  configureServer(server) {
    server.middlewares.use('/__wire-house-mansion-level', async (request, response) => {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      const query = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams;
      if (request.method === 'GET' && query.get('list') === '1') {
        const directory = path.resolve(process.cwd(), '.studio', 'levels');
        const slots: Array<{ id: string; name: string; updatedAt: string; template: string }> = [];
        for (const file of await readdir(directory).catch(() => [])) {
          if (!/^[0-9a-f-]{36}\.json$/i.test(file)) continue;
          try {
            const target = path.join(directory, file);
            const data = JSON.parse(await readFile(target, 'utf8')) as { name?: unknown; template?: unknown; version?: unknown };
            if (data.version !== 1) continue;
            slots.push({ id: file.slice(0, -5), name: typeof data.name === 'string' ? data.name.slice(0, 48) : 'Saved Level',
              updatedAt: (await stat(target)).mtime.toISOString(), template: data.template === 'blank' ? 'blank' : 'mansion' });
          } catch { /* Ignore an incomplete or invalid slot without hiding other saves. */ }
        }
        try {
          const legacy = path.resolve(process.cwd(), '.studio', 'mansion-level.json');
          const data = JSON.parse(await readFile(legacy, 'utf8')) as { version?: unknown };
          if (data.version === 1) slots.push({ id: 'legacy', name: 'Previous project save', updatedAt: (await stat(legacy)).mtime.toISOString(), template: 'mansion' });
        } catch { /* No legacy project save. */ }
        response.end(JSON.stringify({ slots }));
        return;
      }
      const slot = query.get('slot');
      if (slot !== null && !/^[0-9a-f-]{36}$/i.test(slot)) { response.statusCode = 400; response.end(JSON.stringify({ error: 'Invalid level ID' })); return; }
      const target = path.resolve(process.cwd(), '.studio', slot ? path.join('levels', `${slot}.json`) : 'mansion-level.json');
      if (request.method === 'GET') {
        try { response.end(await readFile(target, 'utf8')); }
        catch { response.statusCode = 204; response.end(); }
        return;
      }
      if (request.method !== 'POST') { response.statusCode = 405; response.end(JSON.stringify({ error: 'Method not allowed' })); return; }
      let body = '';
      request.setEncoding('utf8');
      request.on('data', chunk => { body += chunk; if (body.length > 500_000) request.destroy(); });
      request.on('end', async () => {
        try {
          const parsed = JSON.parse(body) as { version?: unknown; name?: unknown; walls?: unknown; surfaces?: unknown; groups?: unknown; playerStart?: unknown; playerStartYaw?: unknown; apprenticeStart?: unknown; apprenticeStarts?: unknown; apprenticeStartYaws?: unknown };
          const triplet = (value: unknown) => Array.isArray(value) && value.length === 3 && value.every(item => typeof item === 'number' && Number.isFinite(item));
          if (parsed.version !== 1 || !Array.isArray(parsed.walls) || parsed.walls.length > 1000 || !Array.isArray(parsed.surfaces) || parsed.surfaces.length > 1000 || !triplet(parsed.playerStart) || !triplet(parsed.apprenticeStart)) throw new Error('Invalid level document');
          if (parsed.name !== undefined && (typeof parsed.name !== 'string' || parsed.name.length > 48)) throw new Error('Invalid level name');
          if (parsed.apprenticeStarts !== undefined && (!Array.isArray(parsed.apprenticeStarts) || parsed.apprenticeStarts.length !== 5 || !parsed.apprenticeStarts.every(triplet))) throw new Error('Invalid apprentice starts');
          if (parsed.playerStartYaw !== undefined && (typeof parsed.playerStartYaw !== 'number' || !Number.isFinite(parsed.playerStartYaw))) throw new Error('Invalid player start yaw');
          if (parsed.apprenticeStartYaws !== undefined && (!Array.isArray(parsed.apprenticeStartYaws) || parsed.apprenticeStartYaws.length !== 5 || !parsed.apprenticeStartYaws.every(value => typeof value === 'number' && Number.isFinite(value)))) throw new Error('Invalid apprentice start yaw');
          for (const wall of parsed.walls) {
            if (!wall || typeof wall !== 'object' || typeof wall.id !== 'string' || wall.id.length > 160 || !['brick-wall', 'concrete-wall'].includes(wall.kind) ||
              !triplet(wall.position) || !triplet(wall.scale) || !Number.isFinite(wall.length) || !Number.isFinite(wall.rotationY)) throw new Error('Invalid wall');
          }
          for (const surface of parsed.surfaces) {
            if (!surface || typeof surface !== 'object' || typeof surface.id !== 'string' || surface.id.length > 160 || !['floor', 'stair'].includes(surface.kind) ||
              !triplet(surface.position) || !triplet(surface.scale) || !Number.isFinite(surface.width) || !Number.isFinite(surface.depth) ||
              !Number.isFinite(surface.rotationY)) throw new Error('Invalid surface');
          }
          if (parsed.groups !== undefined) {
            if (!Array.isArray(parsed.groups) || parsed.groups.length > 200) throw new Error('Invalid groups');
            for (const group of parsed.groups) if (!group || typeof group.id !== 'string' || group.id.length > 80 || typeof group.name !== 'string' || group.name.length > 48 || !Array.isArray(group.members) || group.members.length < 2 || group.members.length > 1000 || !group.members.every((id: unknown) => typeof id === 'string' && id.length <= 160)) throw new Error('Invalid group');
          }
          const serialized = `${JSON.stringify(parsed, null, 2)}\n`;
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(`${target}.tmp`, serialized, 'utf8');
          await rename(`${target}.tmp`, target);
          response.end(JSON.stringify({ savedAt: new Date().toISOString(), path: '.studio/mansion-level.json', contentHash: createHash('sha256').update(serialized).digest('hex') }));
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
  plugins: [waterCanvasReadbackHint(), studioOverrides(), levelEditorDocument()],
  server: { host: '127.0.0.1', port: 5365, strictPort: true },
  preview: { host: '127.0.0.1', port: 5365, strictPort: true },
  build: { target: 'es2022', sourcemap: false },
});
