import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:5365/Electrical-Game/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const createdSlots = [];
await mkdir('output/level-library', { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const ready = async () => {
    await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120000 });
  };
  await page.goto(base);
  await ready();
  assert.equal(await page.locator('#start-level-current').textContent(), 'BASIC · ORIGINAL');
  await page.locator('#start-load').tap();
  assert(await page.locator('.start-level-choice').first().textContent().then(text => text.includes('BASIC · ORIGINAL')));
  await page.screenshot({ path: 'output/level-library/basic-menu-mobile.png' });
  await page.locator('#start-level-picker-close').tap();
  await page.locator('#start-new').tap();
  await ready();
  assert.equal(new URL(page.url()).searchParams.get('template'), 'blank');
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor.active);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#start-screen')).visibility === 'hidden');
  const blank = await page.evaluate(() => {
    const game = window.__wireTheHouse;
    return { visibleWing: game.room.mansionWing.children.filter(item => item.visible).map(item => item.name),
      visibleRoom: game.room.children.filter(item => item.visible).map(item => item.name),
      obstacles: game.room.mansionWing.obstaclesAt(0).length, start: game.renderer.camera.position.toArray() };
  });
  assert.deepEqual(blank.visibleWing, ['Modeled Cypriot terrain and neighbouring unfinished buildings']);
  assert.equal(blank.obstacles, 0);
  assert.deepEqual(blank.start.map(Math.round).filter((_, index) => index !== 1), [8, 5]);
  await page.screenshot({ path: 'output/level-library/new-blank-site-mobile.png' });
  await page.locator('.level-editor__bottom-nav [data-editor-tab="select"]').tap();
  await page.locator('#level-view-quick [data-level-view="2d"]').tap();
  assert.equal(await page.evaluate(() => window.__wireTheHouse.renderer.viewCamera?.type), 'PerspectiveCamera');
  await page.locator('.level-editor__bottom-nav [data-editor-tab="select"]').tap();
  await page.screenshot({ path: 'output/level-library/new-blank-site-2d-mobile.png' });
  await page.locator('[data-editor-tab="build"]').first().tap();
  await page.locator('#level-add-brick').tap();
  await page.locator('[data-editor-tab="save"]').first().tap();
  await page.locator('#level-slot-name').fill('Cyprus house from scratch');
  await page.screenshot({ path: 'output/level-library/new-save-mobile.png' });
  await page.locator('#level-save-mobile').tap();
  await page.waitForFunction(() => new URL(location.href).searchParams.has('level'));
  const firstId = new URL(page.url()).searchParams.get('level');
  createdSlots.push(firstId);
  const first = await page.evaluate(id => ({ slots: JSON.parse(localStorage.getItem('wirehouse:level-editor:slots:v1')), document: JSON.parse(localStorage.getItem('wirehouse:level-editor:slot:' + id)) }), firstId);
  assert.equal(first.slots.length, 1);
  assert.equal(first.document.template, 'blank');
  assert(first.document.walls.some(wall => wall.id.startsWith('Editor brick-wall ')));
  const project = await page.request.get(`http://127.0.0.1:5365/__wire-house-mansion-level?slot=${firstId}`);
  assert.equal(project.status(), 200);
  assert.equal((await project.json()).template, 'blank');
  const otherContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const otherPage = await otherContext.newPage();
  await otherPage.goto(base);
  await otherPage.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120000 });
  await otherPage.locator('#start-load').tap();
  await otherPage.locator('.start-level-choice').filter({ hasText: 'Cyprus house from scratch' }).waitFor();
  await otherPage.locator('.start-level-choice').filter({ hasText: 'Cyprus house from scratch' }).tap();
  await otherPage.waitForURL(url => url.searchParams.get('level') === firstId);
  await otherPage.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120000 });
  assert.equal(await otherPage.locator('#start-level-current').textContent(), 'SAVED · Cyprus house from scratch');
  assert.equal(await otherPage.evaluate(() => window.__wireTheHouse.levelEditor.template), 'blank');
  await otherContext.close();
  const missingPage = await browser.newPage();
  await missingPage.goto(`${base}?mansion=preview&level=00000000-0000-4000-8000-000000000000&renderer=webgl`);
  await missingPage.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, { timeout: 120000 });
  assert.equal(await missingPage.locator('#start-level-current').textContent(), 'SAVED LEVEL UNAVAILABLE');
  assert(await missingPage.locator('#start-button').isDisabled());
  assert(await missingPage.locator('#start-level-editor').isDisabled());
  await missingPage.close();
  await page.reload();
  await ready();
  const restored = await page.evaluate(() => ({ template: window.__wireTheHouse.levelEditor.template,
    added: [...window.__wireTheHouse.room.mansionWing.editableWalls.keys()].filter(name => name.startsWith('Editor ')),
    originalVisible: window.__wireTheHouse.room.children.filter(item => item !== window.__wireTheHouse.room.mansionWing && item !== window.__wireTheHouse.room.exterior && item.visible).length }));
  assert.equal(restored.template, 'blank');
  assert.equal(restored.added.length, 1);
  assert.equal(restored.originalVisible, 0);
  assert.equal(await page.evaluate(() => window.__wireTheHouse.levelEditor.active), true);
  await page.locator('[data-editor-tab="save"]').first().tap();
  await page.locator('#level-slot-name').fill('Second copy');
  await page.locator('#level-save-as').tap();
  await page.waitForFunction(id => new URL(location.href).searchParams.get('level') !== id, firstId);
  const secondId = new URL(page.url()).searchParams.get('level');
  createdSlots.push(secondId);
  assert.notEqual(secondId, firstId);
  const copies = await page.evaluate(id => ({ slots: JSON.parse(localStorage.getItem('wirehouse:level-editor:slots:v1')), old: JSON.parse(localStorage.getItem('wirehouse:level-editor:slot:' + id)) }), firstId);
  assert.equal(copies.slots.length, 2);
  assert.equal(copies.old.template, 'blank');
  await page.locator('.level-editor__bottom-nav [data-editor-tab="starts"]').tap();
  await page.locator('#level-scene-exit').tap();
  await page.locator('#start-load').tap();
  await page.locator('.start-level-choice').filter({ hasText: 'BASIC · ORIGINAL' }).tap();
  await page.waitForURL(url => !url.searchParams.has('level') && !url.searchParams.has('mansion'));
  await ready();
  assert.equal(await page.locator('#start-level-current').textContent(), 'BASIC · ORIGINAL');
  const basic = await page.evaluate(() => ({ wing: window.__wireTheHouse.room.mansionWing, wall: window.__wireTheHouse.room.brickWall.visible }));
  assert.equal(basic.wing, null);
  assert.equal(basic.wall, true);
  await page.locator('#start-load').tap();
  await page.locator('.start-level-choice').filter({ hasText: 'Cyprus house from scratch' }).waitFor();
  await page.screenshot({ path: 'output/level-library/load-three-choices-mobile.png' });
  await page.locator('.start-level-choice').filter({ hasText: 'Cyprus house from scratch' }).tap();
  await page.waitForURL(url => url.searchParams.get('level') === firstId);
  await ready();
  assert.equal(new URL(page.url()).searchParams.get('level'), firstId);
  assert.equal(await page.locator('#start-level-current').textContent(), 'SAVED · Cyprus house from scratch');
  await page.locator('#start-button').tap();
  const played = await page.evaluate(() => ({ started: window.__wireTheHouse.started,
    template: window.__wireTheHouse.levelEditor.template,
    obstacles: window.__wireTheHouse.room.mansionWing.obstaclesAt(0).map(item => item.id) }));
  assert(played.started && played.template === 'blank');
  assert(played.obstacles.some(id => id.startsWith('Editor brick-wall ')));
  assert(played.obstacles.every(id => id.startsWith('Editor ')));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ pass: true, blank, firstId, secondId, slots: copies.slots.map(({ name, template }) => ({ name, template })), restored, played, errors }));
} finally {
  await browser.close();
  for (const id of createdSlots) if (/^[0-9a-f-]{36}$/i.test(id)) await rm(new URL(`../.studio/levels/${id}.json`, import.meta.url), { force: true });
}
