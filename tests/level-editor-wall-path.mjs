import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
await mkdir('artifacts/site-pro-04/review/level-editor-wall-path', { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    window.__editorPointerLockRequests = 0;
    Object.defineProperty(Element.prototype, 'requestPointerLock', { configurable: true, value() {
      window.__editorPointerLockRequests++;
      return Promise.resolve();
    } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5365/Electrical-Game/?mansion=preview&template=blank&editor=1&renderer=webgl');
  await page.waitForFunction(() => window.__wireTheHouse?.levelEditor?.active, null, { timeout: 120000 });
  await page.mouse.click(92, 285);
  assert.equal(await page.evaluate(() => window.__editorPointerLockRequests), 0, 'Level Editor canvas must keep the desktop pointer free');
  await page.locator('[data-editor-tab="build"]').first().tap();
  await page.locator('#level-add-brick').tap();
  assert(await page.locator('#level-wall-tools-toggle').isVisible(), 'Selected wall must expose contextual wall-path tools');
  const initial = await page.evaluate(() => {
    const editor = window.__wireTheHouse.levelEditor;
    const wall = editor.gizmo.object;
    const hit = window.__wireTheHouse.room.mansionWing.obstaclesAt(wall.position.y).find(item => item.id === wall.name);
    return { name: wall.name, scale: wall.scale.toArray(), hitWidth: hit.maxX - hit.minX, count: window.__wireTheHouse.room.mansionWing.editableWalls.size };
  });
  const endHandle = page.locator('[data-wall-end="1"]');
  assert.equal(await endHandle.isVisible(), false, 'Wall endpoints stay out of the scene until Continue is enabled');
  await page.locator('#level-wall-tools-toggle').tap();
  await page.locator('#level-wall-continue').tap();
  await page.locator('#level-details-close').tap();
  await endHandle.waitFor({ state: 'visible' });
  const box = await endHandle.boundingBox();
  assert(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 55, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const stretched = await page.evaluate(() => {
    const editor = window.__wireTheHouse.levelEditor;
    const wall = editor.gizmo.object;
    const hit = window.__wireTheHouse.room.mansionWing.obstaclesAt(wall.position.y).find(item => item.id === wall.name);
    return { scale: wall.scale.toArray(), hitWidth: hit.maxX - hit.minX };
  });
  assert(stretched.scale[0] > initial.scale[0] + .1, `Endpoint drag must extend geometry: ${JSON.stringify({ initial, stretched })}`);
  assert(stretched.hitWidth > initial.hitWidth + .2, 'Endpoint drag must extend collision with the wall');

  const target = await page.evaluate(() => {
    const editor = window.__wireTheHouse.levelEditor;
    const wall = editor.gizmo.object;
    const half = wall.userData.length / 2;
    const start = wall.position.clone().set(half, 0, 0);
    wall.localToWorld(start);
    const end = start.clone(); end.z += 3.1;
    end.project(editor.camera);
    const bounds = window.__wireTheHouse.renderer.webgl.domElement.getBoundingClientRect();
    return { x: bounds.left + (end.x + 1) * bounds.width / 2, y: bounds.top + (1 - end.y) * bounds.height / 2 };
  });
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(200);
  const extended = await page.evaluate(() => {
    const editor = window.__wireTheHouse.levelEditor;
    const wall = editor.gizmo.object;
    return { count: window.__wireTheHouse.room.mansionWing.editableWalls.size, name: wall.name,
      chainId: wall.userData.wallChainId, sectionIndex: wall.userData.wallSectionIndex,
      pathActive: editor.wallPathActive };
  });
  assert.equal(extended.count, initial.count + 1);
  assert.match(extended.chainId, /^[0-9a-f-]{36}$/i);
  assert.equal(extended.pathActive, true);

  await page.locator('#level-wall-tools-toggle').tap();
  await page.locator('#level-wall-continue').tap();
  await page.locator('#level-wall-material').selectOption('concrete-wall');
  const material = await page.evaluate(() => ({ kind: window.__wireTheHouse.levelEditor.gizmo.object.userData.levelEditorKind,
    name: window.__wireTheHouse.levelEditor.gizmo.object.name }));
  assert.equal(material.kind, 'concrete-wall');
  assert.match(material.name, /^Editor concrete-wall /);

  await page.locator('#level-wall-tools-toggle').tap();
  await page.locator('#level-wall-radius').fill('4');
  const countBeforeCurve = await page.evaluate(() => window.__wireTheHouse.room.mansionWing.editableWalls.size);
  assert.equal(await page.evaluate(() => [...window.__wireTheHouse.room.mansionWing.editableWalls.values()].filter(wall => Number.isFinite(wall.userData.curveRadius)).length), 0,
    'A straight wall must never curve until the user explicitly applies CURVE');
  await page.locator('#level-wall-curve-right').tap();
  await page.waitForTimeout(200);
  const curved = await page.evaluate(() => {
    const wing = window.__wireTheHouse.room.mansionWing;
    const sections = [...wing.editableWalls.values()].filter(wall => Number.isFinite(wall.userData.curveRadius));
    const collisionIds = new Set(wing.obstaclesAt(0).map(item => item.id));
    return { total: wing.editableWalls.size, sections: sections.map(wall => ({ name: wall.name, radius: wall.userData.curveRadius,
      chain: wall.userData.wallChainId, section: wall.userData.wallSectionIndex, collision: collisionIds.has(wall.name),
      position: wall.position.toArray(), yaw: wall.rotation.y, length: wall.userData.length, scale: wall.scale.toArray() })) };
  });
  const curveSeams = await page.evaluate(() => {
    const walls = [...window.__wireTheHouse.room.mansionWing.editableWalls.values()]
      .filter(wall => wall.userData.curveShape).sort((a, b) => a.userData.wallSectionIndex - b.userData.wallSectionIndex);
    const edge = (wall, end, radiusOffset) => {
      const shape = wall.userData.curveShape;
      const angle = shape.startAngle + (end ? shape.sweep : 0);
      return wall.localToWorld(new wall.position.constructor(shape.center[0] + Math.cos(angle) * (shape.radius + radiusOffset), 3,
        shape.center[1] + Math.sin(angle) * (shape.radius + radiusOffset)));
    };
    return walls.slice(1).map((wall, index) => Math.max(
      edge(walls[index], true, -.12).distanceTo(edge(wall, false, -.12)),
      edge(walls[index], true, .12).distanceTo(edge(wall, false, .12))));
  });
  assert(curveSeams.every(gap => gap < .001), `Curved section ends must meet without gaps: ${curveSeams}`);
  assert(curved.total > countBeforeCurve + 2, `Curve must generate multiple editable sections: ${JSON.stringify(curved)}`);
  assert(curved.sections.length >= 4 && curved.sections.every(section => section.collision));
  assert.equal(new Set(curved.sections.map(section => section.chain)).size, 1);
  assert.equal(new Set(curved.sections.map(section => section.section)).size, curved.sections.length);
  assert(curved.sections.every(section => Math.abs(section.position[1]) < 1e-6), 'Plan curve must keep every wall section on one vertical level');
  const yawSteps = curved.sections.slice(1).map((section, index) => section.yaw - curved.sections[index].yaw);
  assert(yawSteps.every(step => Math.sign(step) === Math.sign(yawSteps[0]) && Math.abs(step) > 1e-4), 'Curve headings must turn monotonically in one direction');
  await page.evaluate(() => window.__wireTheHouse.levelEditor.focusSelection());
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'artifacts/site-pro-04/review/level-editor-wall-path/mobile-wall-radius-sections.png' });
  await page.evaluate(() => window.__wireTheHouse.levelEditor.setSelection([]));
  await page.screenshot({ path: 'artifacts/site-pro-04/review/level-editor-wall-path/mobile-wall-radius-clear.png' });
  await page.evaluate(() => {
    const editor = window.__wireTheHouse.levelEditor;
    editor.setViewMode('3d');
    editor.setSelection([...window.__wireTheHouse.room.mansionWing.editableWalls.values()].filter(wall => wall.userData.curveShape));
    editor.focusSelection();
    const target = editor.orbit.target;
    editor.camera.position.set(target.x + 4.5, target.y + 7, target.z + 4.5);
    editor.orbit.update();
    editor.setSelection([]);
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'artifacts/site-pro-04/review/level-editor-wall-path/mobile-wall-radius-3d.png' });
  const roundTrip = await page.evaluate(() => {
    const editor = window.__wireTheHouse.levelEditor;
    const wing = window.__wireTheHouse.room.mansionWing;
    const saved = JSON.parse(JSON.stringify(editor.document()));
    const names = saved.walls.filter(wall => wall.curveShape).map(wall => wall.id);
    for (const name of names) wing.removeEditorWall(wing.editableWalls.get(name));
    editor.applyDocument(saved);
    return names.map(name => {
      const wall = wing.editableWalls.get(name);
      const mesh = wall.children.find(child => child.isMesh);
      return { restored: Boolean(wall.userData.curveShape), triangles: mesh.geometry.getAttribute('position').count / 3,
        material: mesh.material.name };
    });
  });
  assert.equal(roundTrip.length, curved.sections.length);
  assert(roundTrip.every(section => section.restored && section.triangles > 24 && section.triangles < 500 && section.material === 'Continuous cast concrete'),
    `Save/load must restore each smooth curved section: ${JSON.stringify(roundTrip)}`);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ pass: true, sectionCount: curved.sections.length, maxEdgeGap: Math.max(...curveSeams),
    restoredSections: roundTrip.length, errors }));
} finally { await browser.close(); }
