import assert from 'node:assert/strict';
import {mkdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';

const root=path.resolve('dist');
const address='http://127.0.0.1:5365/Electrical-Game/';
const mobile=process.argv.includes('--mobile');
const live=process.argv.includes('--live');
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},isMobile:mobile,hasTouch:mobile});
await blockPointerLock(context);
const page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.wav':'audio/wav','.webp':'image/webp','.png':'image/png','.glb':'model/gltf-binary'};
if(!live)await page.route('http://127.0.0.1:5365/**',async route=>{
  const pathname=decodeURIComponent(new URL(route.request().url()).pathname);
  if(pathname==='/__wire-house-studio-overrides')return route.fulfill({contentType:'application/json',body:JSON.stringify({version:1,revision:0,operations:[]})});
  const relative=pathname.replace(/^\/Electrical-Game\/?/,'')||'index.html';
  const file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep))return route.abort();
  try{await stat(file);await route.fulfill({contentType:types[path.extname(file)]??'application/octet-stream',body:await readFile(file)});}
  catch{return route.fulfill({status:404,body:'Not found'});}
});
try{
  await page.goto(address);
  await page.waitForFunction(()=>window.__wireTheHouse?.audio,undefined,{timeout:120000});
  if(!mobile)await page.locator('#apprentice-count').selectOption('0');
  if(mobile)await page.locator('#start-button').tap();else await page.locator('#start-button').click();
  await page.waitForFunction(()=>window.__wireTheHouse.started&&document.querySelector('#start-screen')?.classList.contains('hidden'));
  await page.waitForFunction(()=>window.__wireTheHouse.audio.telemetry.recordedSounds.length===5,undefined,{timeout:30000});
  const loaded=await page.evaluate(()=>window.__wireTheHouse.audio.telemetry);
  assert.deepEqual(loaded.sampleFailures,[]);
  assert.deepEqual(new Set(loaded.recordedSounds),new Set(['spray-can.wav','hammer-drill.wav','concrete-mixer.wav','demo-hammer.wav','tape-measure.wav']));
  await page.waitForTimeout(500);
  await mkdir('output/selected-sounds-ui',{recursive:true});
  await page.screenshot({path:`output/selected-sounds-ui/gameplay-${mobile?'mobile':'desktop'}${live?'-live':''}.png`});
  if(!mobile){
    await page.mouse.move(640,400);await page.mouse.down();
    await page.waitForFunction(()=>window.__wireTheHouse.audio.telemetry.activeLoops.spray===true);
    await page.mouse.up();
    await page.waitForFunction(()=>window.__wireTheHouse.audio.telemetry.activeLoops.spray===false);
  }
  const result=await page.evaluate(async()=>{
    const game=window.__wireTheHouse,audio=game.audio;
    game.step=()=>{};
    const kinds=['spray','drill','mixer','hammer'];
    const details=[];
    for(const kind of kinds){
      audio.setContinuous(kind,true);
      await new Promise(resolve=>setTimeout(resolve,180));
      const sample=audio.recordedLoops.get(kind),synth=audio.loops.get(kind);
      details.push({kind,duration:sample?.source.buffer.duration,sampleGain:sample?.gain.gain.value,synthGain:synth?.gain.gain.value??0});
      audio.setContinuous(kind,false);
    }
    window.dispatchEvent(new CustomEvent('wirehouse:select-tool',{detail:'measure'}));
    audio.stopAll();
    return{details,telemetry:audio.telemetry};
  });
  for(const detail of result.details){assert(detail.duration>.3);assert(detail.sampleGain>.02,`${detail.kind} sample must play`);assert(detail.synthGain<.01,`${detail.kind} synthetic fallback must be muted`);}
  assert.equal(result.telemetry.events.measure,1);
  assert(Object.values(result.telemetry.activeLoops).every(active=>!active));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,mobile,live,loaded:loaded.recordedSounds,details:result.details,errors}));
}finally{await context.close();await browser.close();}
