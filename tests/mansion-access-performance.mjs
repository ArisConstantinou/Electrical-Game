import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { blockPointerLock } from './browser-safety.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { environment: 'Windows Chrome, 390x844 DPR2 mobile emulation, WebGL; not a physical phone', cases: [] };
const dist = resolve('dist');
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.webp':'image/webp',
  '.png':'image/png', '.jpg':'image/jpeg', '.glb':'model/gltf-binary', '.svg':'image/svg+xml' };
try {
  for (const scene of [
    { name:'released-intact', candidate:false, damaged:false },
    { name:'candidate-intact', candidate:true, damaged:false },
    { name:'candidate-locally-fractured', candidate:true, damaged:false, local:true },
    { name:'candidate-damaged', candidate:true, damaged:true },
  ]) {
    const context = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2,
      isMobile:true, hasTouch:true });
    await blockPointerLock(context);
    if (scene.candidate) await context.route('https://arisconstantinou.github.io/Electrical-Game/**', async route => {
      const file = resolve(dist, decodeURIComponent(new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length)) || 'index.html');
      if (!file.startsWith(`${dist}\\`)) return route.abort();
      try {
        if (!(await stat(file)).isFile()) return route.abort();
        await route.fulfill({ status:200, contentType:mime[extname(file)] ?? 'application/octet-stream', body:await readFile(file) });
      } catch { await route.abort(); }
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto((scene.candidate ? 'https://arisconstantinou.github.io' : 'http://127.0.0.1:5365') +
      '/Electrical-Game/?mansion=preview&renderer=webgl');
    await page.waitForFunction(() => window.__wireTheHouse?.isReadyForStart, null, {timeout:120000});
    await page.locator('#apprentice-count').selectOption('0');
    await page.locator('#start-button').tap();
    await page.evaluate(({damaged,local}) => {
      const game = window.__wireTheHouse;
      game.player.camera.position.set(15.3, 1.65, local ? 15.0 : 13.2);
      game.player.yaw = Math.PI;
      game.player.wallWorkEnabled = false;
      game.selectedTool = 'hammer';
      game.fpsRig.show('hammer');
      if (local) {
        const hit=game.room.mansionWing.aimMasonry(game.renderer.camera);
        for(let i=0;i<6;i++)hit?.wall.strikeAt(hit.index,game.renderer.camera);
        game.player.camera.position.set(15.3, 1.65, 13.2);
      }
      if (damaged) {
        const wall = game.room.mansionWing.masonryDemolition.get('Courtyard north fired-clay enclosure');
        for (let index=0; index<wall.original.length; index++) {
          const matrix=wall.original[index].elements;
          if (Math.abs(matrix[12] - 1.8)<.76 && matrix[13]<2.1) wall.strike(index);
        }
      }
      const render=game.renderer.gpu.render.bind(game.renderer.gpu);
      window.__accessProfile={active:false,times:[],draws:[],triangles:[]};
      game.renderer.gpu.render=(world,camera)=>{
        const result=render(world,camera), p=window.__accessProfile;
        if(p.active && world===game.renderer.scene && !game.renderer.gpu.getRenderTarget()){
          p.times.push(performance.now());
          p.draws.push(game.renderer.webgl.info.render.calls);
          p.triangles.push(game.renderer.webgl.info.render.triangles);
        }
        return result;
      };
      let sign=1;
      window.__accessMotion=setInterval(()=>{
        game.player.yaw+=.004*sign;
        if(Math.abs(game.player.yaw-Math.PI)>.35) sign*=-1;
        game.input.mobileMove.y=-.35;
      },16);
    }, scene);
    await page.waitForTimeout(500);
    await page.evaluate(()=>{window.__accessProfile.active=true;});
    await page.waitForTimeout(2200);
    const sample=await page.evaluate(()=>{
      clearInterval(window.__accessMotion);
      const p=window.__accessProfile;
      p.active=false;
      const intervals=p.times.slice(1).map((time,index)=>time-p.times[index]).sort((a,b)=>a-b);
      const mean=values=>values.reduce((sum,value)=>sum+value,0)/values.length;
      return { frames:p.times.length, p95Ms:intervals[Math.floor(intervals.length*.95)]??null,
        maxMs:intervals.at(-1)??null, meanDrawCalls:mean(p.draws), meanTriangles:mean(p.triangles),
        renderError:window.__wireTheHouse.renderer.renderError };
    });
    assert(sample.frames>30 && !sample.renderError && !errors.length, `${scene.name}: ${JSON.stringify({sample,errors})}`);
    report.cases.push({name:scene.name,...sample});
    await context.close();
  }
} finally {
  await browser.close();
  await mkdir('output/mansion-access-performance',{recursive:true});
  await writeFile('output/mansion-access-performance/report.json',JSON.stringify(report,null,2));
}
console.log(JSON.stringify(report));
