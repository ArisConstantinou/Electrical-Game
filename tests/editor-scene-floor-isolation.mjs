import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { blockPointerLock } from './browser-safety.mjs';

const names = [
  'Living room first-fix mission',
  'Wet mortar, water and construction spills',
  'PVC physical working piece',
  'Water Pro room puddles, runoff and flood',
  'Apprentice 1',
  'FPS hammer tool',
];
const viewModelNames = [
  'Right fixed-length work arm', 'Left fixed-length work arm',
  'Left five-finger spring hand', 'Right five-finger spring hand',
];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const [name, viewport, mobile] of [
    ['desktop', { width: 1440, height: 900 }, false],
    ['mobile', { width: 390, height: 844 }, true],
  ]) {
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
    await blockPointerLock(context);
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
    await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
    const result = await page.evaluate(({ names, viewModelNames }) => {
      const game = window.__wireTheHouse, editor = game.levelEditor;
      const objects = names.map(name => game.renderer.scene.children.find(object => object.name === name));
      if (objects.some(object => !object)) throw new Error('A ground-only scene actor is missing');
      const visible = () => Object.fromEntries(objects.map((object, index) => [names[index], object.visible]));
      const viewModels = viewModelNames.map(name => game.renderer.scene.children.find(object => object.name === name));
      if (viewModels.some(object => !object)) throw new Error('A detached viewmodel is missing');
      const modelsVisible = () => Object.fromEntries(viewModels.map((object, index) => [viewModelNames[index], object.visible]));
      editor.setFloorIndex(0);
      const ground = visible();
      const groundModels = modelsVisible();
      editor.setFloorIndex(1);
      const upper = visible();
      const upperModels = modelsVisible();
      editor.setFloorIndex(5);
      const basement = visible();
      editor.setFloorIndex(0);
      editor.setTemplateMode('blank');
      const blank = visible();
      editor.setTemplateMode('mansion');
      const returned = visible();
      editor.close();
      const gameplay = visible();
      const gameplayModels = modelsVisible();
      return { ground, upper, basement, blank, returned, gameplay,
        groundModels, upperModels, gameplayModels, renderError: game.renderer.renderError };
    }, { names, viewModelNames });
    for (const [state, expected] of [
      ['ground', true], ['upper', false], ['basement', false],
      ['blank', false], ['returned', true], ['gameplay', true],
    ]) {
      for (const actor of names) assert.equal(result[state][actor], expected, `${name}: ${actor} on ${state}`);
    }
    for (const actor of viewModelNames) {
      assert.equal(result.groundModels[actor], false, `${name}: editor hides ${actor}`);
      assert.equal(result.upperModels[actor], false, `${name}: upper editor hides ${actor}`);
      assert.equal(result.gameplayModels[actor], true, `${name}: gameplay restores ${actor}`);
    }
    assert.equal(result.renderError, '');
    console.log(JSON.stringify({ name, groundActors: names.length, detachedViewModels: viewModelNames.length,
      upperHidden: true, blankHidden: true, gameplayRestored: true, renderError: result.renderError }));
    await context.close();
  }
} finally { await browser.close(); }
