import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const dist=resolve('dist');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp',
  '.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary','.svg':'image/svg+xml'};
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const context=await browser.newContext({viewport:{width:1366,height:768}});
  await blockPointerLock(context);
  await context.route('https://arisconstantinou.github.io/Electrical-Game/**',async route=>{
    const file=resolve(dist,decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length))||'index.html');
    if(!file.startsWith(`${dist}\\`))return route.abort();
    try{if(!(await stat(file)).isFile())return route.abort();
      await route.fulfill({status:200,contentType:mime[extname(file)]??'application/octet-stream',body:await readFile(file)});
    }catch{return route.abort();}
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('https://arisconstantinou.github.io/Electrical-Game/?mansion=preview&editor=1&renderer=webgl');
  await page.waitForFunction(()=>window.__wireTheHouse?.levelEditor?.active,null,{timeout:120000});
  const original='Foyer north fired-clay perimeter';
  await page.evaluate(name=>{
    const game=window.__wireTheHouse;
    game.levelEditor.selectWall(game.room.mansionWing.editableWalls.get(name));
  },original);
  await page.locator('#level-wall-tools-toggle').click();
  await page.locator('#level-wall-opening-width').fill('1.5');
  await page.locator('#level-wall-opening-position').fill('3.5');
  await page.locator('#level-wall-opening').click();
  const cut=await page.evaluate(name=>{
    const game=window.__wireTheHouse,wing=game.room.mansionWing,editor=game.levelEditor;
    const wall=wing.editableWalls.get(name);
    const pieces=[...wing.editableWalls.values()].filter(item=>item.userData.wallChainId && item.name.startsWith('Editor brick-wall '));
    const document=editor.document();
    const obstacle=wing.obstaclesAt(0).find(item=>item.id===name);
    return {hidden:wall.userData.levelEditorHidden,visible:wall.visible,
      bounds:[obstacle.minX,obstacle.maxX],pieceNames:pieces.map(item=>item.name),
      savedHidden:document.hiddenWalls.includes(name),savedPieces:document.walls.filter(item=>pieces.some(piece=>piece.name===item.id)).length};
  },original);
  assert.equal(cut.hidden,true);
  assert.equal(cut.visible,false);
  assert.equal(cut.bounds[0],Infinity);
  assert.equal(cut.pieceNames.length,2);
  assert(cut.savedHidden && cut.savedPieces===2);
  const history=await page.evaluate(name=>{
    const game=window.__wireTheHouse,editor=game.levelEditor,wing=game.room.mansionWing;
    editor.moveHistory(-1);
    const undo={visible:wing.editableWalls.get(name).visible,parts:cutParts()};
    editor.moveHistory(1);
    const redo={hidden:wing.editableWalls.get(name).userData.levelEditorHidden,parts:cutParts()};
    function cutParts(){return [...wing.editableWalls.values()].filter(item=>item.userData.wallChainId && item.name.startsWith('Editor brick-wall ')).length;}
    return {undo,redo};
  },original);
  assert.equal(history.undo.visible,true);
  assert.equal(history.undo.parts,0);
  assert.equal(history.redo.hidden,true);
  assert.equal(history.redo.parts,2);
  const traverse=await page.evaluate(()=>{
    const game=window.__wireTheHouse;
    game.levelEditor.close();
    game.step=()=>{};
    const player=game.player,camera=player.camera;
    player.wallWorkEnabled=false;
    camera.position.set(2.15,player.eyeHeight,14.6);
    player.yaw=Math.PI;
    game.input.mobileMove.y=-1;
    for(let i=0;i<170;i++)player.update(1/60);
    game.input.mobileMove.y=0;
    return {z:camera.position.z,hidden:game.room.mansionWing.editableWalls.get('Foyer north fired-clay perimeter').visible,
      error:game.renderer.renderError};
  });
  assert(traverse.z>16.2,`Editor opening did not become a walkable route: ${JSON.stringify(traverse)}`);
  assert.equal(traverse.hidden,false);
  assert.equal(traverse.error,'');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({pass:true,cut,history,traverse}));
} finally {await browser.close();}
