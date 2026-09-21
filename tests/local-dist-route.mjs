import {stat} from 'node:fs/promises';
import path from 'node:path';

// Exercise this checkout's built game at the project's fixed URL without
// replacing a different task's listener on port 5365.
export async function routeLocalDist(page) {
  const root = process.cwd();
  await page.route('http://127.0.0.1:5365/Electrical-Game/**', async route => {
    const relative = decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length)) || 'index.html';
    if (relative.includes('..')) return route.abort();
    for (const base of ['dist', 'public']) {
      const file = path.join(root, base, relative);
      try { if ((await stat(file)).isFile()) return route.fulfill({path:file}); } catch { /* Try the other asset root. */ }
    }
    return route.continue();
  });
}
