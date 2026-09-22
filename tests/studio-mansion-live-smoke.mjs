import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const gameOrigin = 'http://127.0.0.1:5365';
const html = `<!doctype html><iframe id="game" src="${gameOrigin}/Electrical-Game/?studio=1&mansion=preview&renderer=webgl" style="width:900px;height:600px"></iframe><script>
const messages=[];const token='abcdefghijklmnopqrstuvwxyzABCDEF';let number=0;
const send=body=>document.querySelector('#game').contentWindow.postMessage({format:'web-game-studio-runtime-message',protocol:'web-game-studio-adapter',version:1,sessionId:'mansion-editor-qa',sessionToken:token,messageId:'mansion-'+(++number),...body},'${gameOrigin}');
addEventListener('message',event=>{if(event.origin!=='${gameOrigin}')return;messages.push(event.data);if(event.data.type==='adapter/hello')send({type:'studio/snapshot-request'});});
document.querySelector('#game').addEventListener('load',()=>send({type:'studio/hello',gameId:'wire-the-house-electrical-game',entrypointId:'mansion-construction'}));
window.qa={messages,send};
</script>`;
const server = createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(html); });
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5347, '127.0.0.1', resolve); });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  const missing = [];
  page.on('response', response => { if (response.status() === 404) missing.push(response.url()); });
  let rejectFatal;
  const fatal = new Promise((_resolve, reject) => { rejectFatal = reject; });
  page.on('pageerror', error => { errors.push(error.message); if (error.message.includes('Stable node ID collision')) rejectFatal(error); });
  page.on('console', message => { if (message.type() === 'error') { errors.push(message.text()); if (message.text().includes('Stable node ID collision')) rejectFatal(new Error(message.text())); } });
  await page.goto('http://127.0.0.1:5347/', { waitUntil: 'domcontentloaded' });
  try { await Promise.race([page.waitForFunction(() => window.qa.messages.some(message => message.type === 'adapter/snapshot'), null, { timeout: 120_000 }), fatal]); }
  catch (error) {
    console.error(JSON.stringify({ messages: await page.evaluate(() => window.qa.messages), frames: page.frames().map(frame => frame.url()), errors }));
    throw error;
  }
  const snapshot = await page.evaluate(() => window.qa.messages.find(message => message.type === 'adapter/snapshot').snapshot);
  assert.equal(snapshot.entrypointId, 'mansion-construction');
  const wall = snapshot.scene.nodes.find(node => node.name === 'Passage west fired-clay partition');
  assert(wall, 'Mansion wall must be a stable Studio node');
  const before = await page.frameLocator('#game').locator('body').evaluate(() => {
    const wing = window.__wireTheHouse.room.mansionWing;
    return wing.obstaclesAt(0).find(item => item.id === 'Passage west fired-clay partition').minX;
  });
  await page.evaluate(({ id, position }) => window.qa.send({ type: 'studio/patch', baseRevision: 0, operations: [{ op: 'replace', target: { kind: 'node', id }, path: '/transform/position', value: position }] }), { id: wall.id, position: [wall.transform.position[0] + .5, ...wall.transform.position.slice(1)] });
  await page.waitForFunction(() => window.qa.messages.some(message => message.type === 'adapter/patch-ack'));
  const after = await page.frameLocator('#game').locator('body').evaluate(() => {
    const wing = window.__wireTheHouse.room.mansionWing;
    return wing.obstaclesAt(0).find(item => item.id === 'Passage west fired-clay partition').minX;
  });
  assert(Math.abs(after - before - .5) < .001, `Studio transform must move the live collider (${before} -> ${after})`);
  assert.deepEqual(errors, [], `404 responses: ${missing.join(', ')}`);
  console.log(JSON.stringify({ pass: true, entrypointId: snapshot.entrypointId, nodes: snapshot.scene.nodes.length, wallId: wall.id, colliderShift: after - before }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
