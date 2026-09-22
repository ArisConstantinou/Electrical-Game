import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { blockPointerLock } from './browser-safety.mjs';

const out = 'output/mansion-drawings-ui';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { cases: [], errors: [], mobileIsEmulation: true };
try {
  for (const config of [
    { name: 'mobile-portrait', viewport: { width: 390, height: 844 }, isMobile: true },
    { name: 'tablet-landscape', viewport: { width: 1024, height: 768 }, isMobile: true },
    { name: 'desktop', viewport: { width: 1440, height: 900 }, isMobile: false },
  ]) {
    const context = await browser.newContext({ viewport: config.viewport, isMobile: config.isMobile, hasTouch: config.isMobile, deviceScaleFactor: 1 });
    await blockPointerLock(context);
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(`${config.name}: ${e.message}`));
    await page.goto('http://127.0.0.1:5365/Electrical-Game/?renderer=webgl');
    await page.locator('#start-button').waitFor({ state: 'visible', timeout: 120000 });
    await page.waitForFunction(() => !document.querySelector('#start-button')?.disabled, null, { timeout: 120000 });
    await page.locator('#start-button').click();
    await page.waitForFunction(() => window.__wireTheHouse?.workerBody.loaded, null, { timeout: 120000 });
    await page.evaluate(() => {
      const g = window.__wireTheHouse;
      g.mixing.setActive(false);
      g.player.velocity.set(0, 0, 0);
      g.renderer.camera.position.set(.8, 1.65, 2.3);
      g.player.yaw = 0;
      g.player.pitch = -.22;
    });
    await page.waitForTimeout(500);
    if(config.name==='mobile-portrait'){
      const nearMiss=await page.evaluate(()=>{const g=window.__wireTheHouse,a=g.apprentice,c=g.renderer.camera;c.rotation.y=.24;c.updateMatrixWorld(true);a.groundRay.setFromCamera(a.groundPoint.set(0,0),c);const meshHits=a.groundRay.intersectObject(a.body,true).length,opens=a.tryOpenDrawingsOnAim();c.rotation.y=0;c.updateMatrixWorld(true);if(opens)a.command('point');return{meshHits,opens};});
      assert.equal(nearMiss.meshHits,0,'Crosshair is outside the actual apprentice mesh');
      assert.equal(nearMiss.opens,false,'Near-miss beside apprentice must not open drawings');
      const equipmentOcclusion=await page.evaluate(()=>{const g=window.__wireTheHouse,a=g.apprentice,c=g.renderer.camera,group=g.mixing.models.group,mixer=g.mixing.models.concreteMixer;let source; mixer.traverse(object=>{if(!source&&object.isMesh)source=object;});const blocker=source.clone(false);blocker.geometry=source.geometry.clone();blocker.geometry.center();blocker.position.copy(group.worldToLocal(c.position.clone().lerp(a.camera.position,.5)));blocker.scale.setScalar(3);blocker.visible=true;group.add(blocker);group.updateWorldMatrix(true,true);const blockerHits=a.aimRaycaster.intersectObject(blocker,true).length,opens=a.tryOpenDrawingsOnAim();group.remove(blocker);blocker.geometry.dispose();if(opens)a.command('point');return{blockerHits,opens};});
      assert(equipmentOcclusion.blockerHits>0,'Foreground construction equipment covers the worker');
      assert.equal(equipmentOcclusion.opens,false,'Equipment in front of apprentice keeps USE priority');
    }
    const aimMs=await page.evaluate(()=>{const a=window.__wireTheHouse.apprentice,start=performance.now();for(let i=0;i<200;i++)a.aimedAtApprentice();return(performance.now()-start)/200;});
    assert(aimMs<4,`${config.name}: apprentice targeting costs ${aimMs.toFixed(2)} ms per query`);
    const promptVisible=await page.locator('#apprentice-drawing-prompt').isVisible();
    assert(promptVisible,`${config.name}: looking at apprentice shows drawing prompt`);
    assert.equal(await page.locator('#apprentice-drawing-prompt').textContent(),config.isMobile?'ΣΧΕΔΙΑ':'E · ΣΧΕΔΙΑ',`${config.name}: aim caption must not duplicate the mobile USE button`);
    await page.screenshot({path:`${out}/${config.name}-aim.png`});
    if(config.isMobile)await page.locator('#site-pro-use').tap();else await page.keyboard.press('e');
    await page.waitForFunction(()=>window.__wireTheHouse?.apprentice.mode==='plan',null,{timeout:10000});
    const aimed = await page.evaluate(() => window.__wireTheHouse.apprentice.mode === 'plan');
    assert(aimed, `${config.name}: looking at apprentice opens drawings`);
    await page.locator('#apprentice-mobile-plan').waitFor({ state: 'visible' });
    const labels = await page.locator('[data-drawing-tab]').allTextContents();
    assert.deepEqual(labels, ['Ηλεκτρολογικό', 'Ισόγειο', 'Τομή ορόφων']);
    for (const tab of ['electrical', 'ground', 'section']) {
      await page.locator(`[data-drawing-tab="${tab}"]`).click();
      const image = page.locator('.drawing-scroll img');
      await image.evaluate(img => img.decode());
      assert((await image.evaluate(img => img.naturalWidth)) >= 1200);
      await page.screenshot({ path: `${out}/${config.name}-${tab}.png` });
    }
    if(config.name==='mobile-portrait'){
      const scroll=await page.locator('.drawing-scroll').evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth}));
      assert(scroll.scroll>scroll.client*1.5,'Portrait drawing starts at readable zoom');
      await page.locator('[data-drawing-zoom]').click();
      const fitted=await page.locator('.drawing-scroll').evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth}));
      assert(fitted.scroll<=fitted.client+2,'Portrait overview fits width');
      await page.screenshot({path:`${out}/${config.name}-overview.png`});
    }
    const bounds = await page.locator('#apprentice-mobile-plan').boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= config.viewport.width + 1 && bounds.y + bounds.height <= config.viewport.height + 1, `${config.name}: drawing viewer fits viewport`);
    await page.locator('[data-drawing-close]').click();
    await page.locator('#apprentice-mobile-plan').waitFor({state:'hidden',timeout:5000});
    report.cases.push({ name: config.name, labels, bounds, aimOpened: aimed, aimedCheckMs:aimMs });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ passed: report.passed, cases: report.cases.length, errors: report.errors }));
