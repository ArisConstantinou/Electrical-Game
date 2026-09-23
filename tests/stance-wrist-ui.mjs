import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const root = 'http://127.0.0.1:5365/Electrical-Game/?renderer=webgl';
const out = 'output/stance-wrist';
const baseline = process.argv.includes('--baseline');
const candidate = process.argv.includes('--candidate');
const phase = baseline ? 'before' : candidate ? 'candidate' : 'after';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await blockPointerLock(context);
  let candidateLoads = 0;
  let baselineLoads = 0;
  if (baseline) await context.route('**/assets/worker/worker.glb*', route => { baselineLoads++; return route.fulfill({ path: `${out}/worker-original.glb`, contentType: 'model/gltf-binary' }); });
  if (candidate) await context.route('**/assets/worker/worker.glb*', route => { candidateLoads++; return route.fulfill({ path: `${out}/worker-candidate.glb`, contentType: 'model/gltf-binary' }); });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(root);
  if (baseline) {
    const stand = (await readFile(`${out}/stand-person-original.svg`)).toString('base64');
    const crouch = (await readFile(`${out}/crouch-person-original.svg`)).toString('base64');
    await page.addStyleTag({ content: `#mobile-stance-controls #mobile-stand::before{background-image:url("data:image/svg+xml;base64,${stand}")!important}#mobile-stance-controls #mobile-crouch::before{background-image:url("data:image/svg+xml;base64,${crouch}")!important}` });
  }
  await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart);
  await page.locator('#start-button').tap();
  await page.waitForFunction(() => window.__wireTheHouse?.started && window.__wireTheHouse?.workerBody?.loaded);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}/${phase}-stand.png` });
  await page.screenshot({ path: `${out}/${phase}-icons-stand.png`, clip: { x: 125, y: 690, width: 75, height: 140 } });
  await page.locator('#mobile-crouch').tap();
  await page.waitForFunction(() => window.__wireTheHouse.player.crouched);
  await page.screenshot({ path: `${out}/${phase}-crouch.png` });
  await page.screenshot({ path: `${out}/${phase}-icons-crouch.png`, clip: { x: 125, y: 690, width: 75, height: 140 } });
  await page.locator('#mobile-stand').tap();
  await page.waitForFunction(() => !window.__wireTheHouse.player.crouched);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('wirehouse:coordinator-open'));
    const game = window.__wireTheHouse;
    game.player.pitch = -1.05;
    for (let i = 0; i < 20; i++) game.step(1 / 60);
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${phase}-directive.png` });
  await page.screenshot({ path: `${out}/${phase}-hand.png`, clip: { x: 195, y: 490, width: 195, height: 185 } });
  const state = await page.evaluate(() => ({
    stand: document.querySelector('#mobile-stand').getAttribute('aria-pressed'),
    crouch: document.querySelector('#mobile-crouch').getAttribute('aria-pressed'),
    bodyLoaded: window.__wireTheHouse.workerBody.loaded,
    screen: { width: innerWidth, height: innerHeight },
    standBackground: getComputedStyle(document.querySelector('#mobile-stand'), '::before').backgroundImage,
    crouchBackground: getComputedStyle(document.querySelector('#mobile-crouch'), '::before').backgroundImage,
  }));
  assert.equal(state.stand, 'true');
  assert.equal(state.crouch, 'false');
  assert.equal(state.bodyLoaded, true);
  if (baseline) assert(baselineLoads > 0, 'Original worker asset was not loaded');
  if (candidate) assert(candidateLoads > 0, 'Candidate worker asset was not loaded');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ state: { ...state, standBackground: state.standBackground.slice(0, 64), crouchBackground: state.crouchBackground.slice(0, 64) }, errors, candidateLoads }));
  await context.close();
  const desktop = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await blockPointerLock(desktop);
  if (baseline) await desktop.route('**/assets/worker/worker.glb*', route => route.fulfill({ path: `${out}/worker-original.glb`, contentType: 'model/gltf-binary' }));
  if (candidate) await desktop.route('**/assets/worker/worker.glb*', route => route.fulfill({ path: `${out}/worker-candidate.glb`, contentType: 'model/gltf-binary' }));
  const desktopPage = await desktop.newPage();
  desktopPage.on('pageerror', error => errors.push(error.message));
  await desktopPage.goto(root);
  await desktopPage.waitForFunction(() => window.__wireTheHouse?.isReadyForStart);
  await desktopPage.locator('#start-button').click();
  await desktopPage.waitForFunction(() => window.__wireTheHouse?.started && window.__wireTheHouse?.workerBody?.loaded);
  await desktopPage.evaluate(() => {
    window.dispatchEvent(new Event('wirehouse:coordinator-open'));
    const game = window.__wireTheHouse;
    game.player.pitch = -1.05;
    for (let i = 0; i < 20; i++) game.step(1 / 60);
  });
  await desktopPage.waitForTimeout(250);
  await desktopPage.screenshot({ path: `${out}/${phase}-desktop-hand.png` });
  assert.deepEqual(errors, []);
  await desktop.close();
  if (!baseline && !candidate) for (const layout of [
    { name: 'compact', width: 320, height: 740 },
    { name: 'landscape', width: 844, height: 390 },
  ]) {
    const extra = await browser.newContext({ viewport: { width: layout.width, height: layout.height }, isMobile: true, hasTouch: true });
    await blockPointerLock(extra);
    const view = await extra.newPage();
    view.on('pageerror', error => errors.push(error.message));
    await view.goto(root);
    await view.waitForFunction(() => window.__wireTheHouse?.isReadyForStart);
    await view.locator('#start-button').tap();
    await view.waitForFunction(() => window.__wireTheHouse?.started && window.__wireTheHouse?.workerBody?.loaded);
    const iconState = await view.evaluate(() => Object.fromEntries(['stand', 'crouch'].map(name => {
      const button = document.querySelector(`#mobile-${name}`);
      const box = button.getBoundingClientRect();
      const icon = getComputedStyle(button, '::before');
      return [name, { width: box.width, height: box.height, iconWidth: parseFloat(icon.width), iconHeight: parseFloat(icon.height), image: icon.backgroundImage }];
    })));
    for (const icon of Object.values(iconState)) {
      assert(icon.width >= 44 && icon.height >= 44, `${layout.name}: stance touch target too small`);
      assert(icon.iconWidth >= 28 && icon.iconHeight >= 28 && icon.image.includes('data:image/svg+xml'), `${layout.name}: filled person icon missing`);
    }
    await view.locator('#mobile-crouch').tap();
    await view.waitForFunction(() => window.__wireTheHouse.player.crouched);
    await view.screenshot({ path: `${out}/after-${layout.name}-crouch.png` });
    await view.locator('#mobile-stand').tap();
    await view.waitForFunction(() => !window.__wireTheHouse.player.crouched);
    assert.deepEqual(errors, []);
    await extra.close();
  }
} finally { await browser.close(); }
