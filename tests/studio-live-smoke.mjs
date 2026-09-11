import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const gameOrigin = 'http://127.0.0.1:5362';
const gameUrl = `${gameOrigin}/Electrical-Game/?studio=1`;
const output = new URL('../output/qa/', import.meta.url);
const sidecar = new URL('../.studio/wire-the-house-overrides.json', import.meta.url);
await mkdir(output, { recursive: true });
const parentHtml = `<!doctype html><meta charset="utf-8"><iframe id="game" src="${gameUrl}" style="width:800px;height:600px"></iframe><script>
const messages=[]; const token='abcdefghijklmnopqrstuvwxyzABCDEF'; let message=0;
const send=(body)=>document.querySelector('#game').contentWindow.postMessage({format:'web-game-studio-runtime-message',protocol:'web-game-studio-adapter',version:1,sessionId:'studio-live-qa',sessionToken:token,messageId:'studio-'+(++message),...body},'${gameOrigin}');
window.addEventListener('message',event=>{if(event.origin!=='${gameOrigin}')return;messages.push(event.data);if(event.data.type==='adapter/hello')send({type:'studio/snapshot-request'});});
document.querySelector('#game').addEventListener('load',()=>send({type:'studio/hello',gameId:'wire-the-house-electrical-game',entrypointId:'living-room-first-fix'}));
window.studioQa={messages,send};
</script>`;
const server = createServer((request, response) => { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(parentHtml); });
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5347, '127.0.0.1', resolve); });
const browser = await chromium.launch({ channel: 'chrome', headless: true });

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5347/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.studioQa.messages.some(message => message.type === 'adapter/snapshot'), null, { timeout: 15_000 });
  const firstSnapshot = await page.evaluate(() => window.studioQa.messages.find(message => message.type === 'adapter/snapshot').snapshot);
  const light = firstSnapshot.scene.lights[0];
  if (!light || firstSnapshot.scene.nodes.length < 50 || firstSnapshot.gameplay.length < 3) throw new Error('Studio snapshot is missing editable scene/gameplay data');
  await page.evaluate(lightId => window.studioQa.send({ type: 'studio/patch', baseRevision: 0, historyGroupId: 'qa-light-edit', operations: [{ op: 'replace', target: { kind: 'light', id: lightId }, path: '/intensity', value: 0.77 }] }), light.id);
  await page.waitForFunction(() => window.studioQa.messages.some(message => message.type === 'adapter/patch-ack'));
  await page.evaluate(() => window.studioQa.send({ type: 'studio/save', baseRevision: 1 }));
  await page.waitForFunction(() => window.studioQa.messages.some(message => message.type === 'adapter/save-ack'));
  const save = await page.evaluate(() => window.studioQa.messages.find(message => message.type === 'adapter/save-ack'));
  if (!/^[a-f0-9]{64}$/.test(save.contentHash)) throw new Error('Studio save did not return a SHA-256 content hash');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.studioQa.messages.some(message => message.type === 'adapter/snapshot'), null, { timeout: 15_000 });
  const restoredSnapshot = await page.evaluate(() => window.studioQa.messages.find(message => message.type === 'adapter/snapshot').snapshot);
  const restoredLight = restoredSnapshot.scene.lights.find(item => item.id === light.id);
  const restoredIntensity = restoredLight?.properties.find(item => item.path === '/intensity')?.value;
  if (restoredIntensity !== 0.77) throw new Error(`Saved Studio light edit did not restore; received ${restoredIntensity}`);
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(new URL('studio-snapshot.json', output), `${JSON.stringify(restoredSnapshot, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ handshake: true, nodes: restoredSnapshot.scene.nodes.length, materials: restoredSnapshot.scene.materials.length, cameras: restoredSnapshot.scene.cameras.length, lights: restoredSnapshot.scene.lights.length, physicsBodies: restoredSnapshot.physics.bodies.length, gameplayProperties: restoredSnapshot.gameplay.length, patchRevision: 1, saveHash: save.contentHash, reloadRestoredIntensity: restoredIntensity }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await unlink(fileURLToPath(sidecar)).catch(() => undefined);
}
