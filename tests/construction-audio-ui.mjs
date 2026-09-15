import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {blockPointerLock} from './browser-safety.mjs';

const url=process.argv[2]??'http://127.0.0.1:5362/Electrical-Game/';
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await blockPointerLock(context);
const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
try{
  await page.goto(url);await page.waitForFunction(()=>window.__wireTheHouse?.audio,undefined,{timeout:120000});await page.locator('#start-button').tap();
  await page.evaluate(()=>{const g=window.__wireTheHouse;window.__audioStep=g.step.bind(g);g.step=()=>{};const oneShots=['hammer','box','level','spring','cutter','mark','laser','trowel-whoosh','mortar-splat','water-pour','sack-tear','cement-scrape','sand-scoop','mixer-insert','mixer-rinse'];for(const sound of oneShots)g.audio.play(sound);for(const sound of ['spray','hose','drill','driver','trowel','mixer'])g.audio.setContinuous(sound,true);});
  await page.waitForTimeout(120);
  const active=await page.evaluate(()=>window.__wireTheHouse.audio.telemetry);assert.equal(active.contextState,'running','Real pointer gesture must unlock Web Audio');assert.equal(Object.keys(active.events).length,15);assert(Object.values(active.events).every(count=>count===1));assert(Object.values(active.activeLoops).every(Boolean),'Every continuous construction tool loop must run');
  await page.evaluate(()=>{const a=window.__wireTheHouse.audio;for(const sound of ['spray','hose','drill','driver','trowel','mixer'])a.setContinuous(sound,false);});await page.waitForTimeout(100);
  const stopped=await page.evaluate(()=>window.__wireTheHouse.audio.telemetry);assert(Object.values(stopped.activeLoops).every(active=>!active),'All loops must stop on tool release');assert.deepEqual(errors,[]);
  const waveforms=await page.evaluate(async()=>{
    const AudioBank=window.__wireTheHouse.audio.constructor,RealAudioContext=window.AudioContext,results=[];
    const measure=data=>{
      let peak=0,energy=0,bass=0,low=0,tail=0;
      for(let i=0;i<data.length;i++){
        const sample=data[i];peak=Math.max(peak,Math.abs(sample));energy+=sample*sample;
        low+=(sample-low)*(1-Math.exp(-2*Math.PI*80/48000));bass+=low*low;
        if(i>data.length*.8)tail+=sample*sample;
      }
      return{peak,rms:Math.sqrt(energy/data.length),bassRatio:bass/energy,tailRms:Math.sqrt(tail/(data.length*.2))};
    };
    for(const [kind,isLoop] of [...Object.keys(window.__wireTheHouse.audio.telemetry.events).map(kind=>[kind,false]),...['spray','hose','drill','driver','trowel','mixer'].map(kind=>[kind,true])]){
      const offline=new OfflineAudioContext(1,48000,48000),bank=new AudioBank();
      // Exercise the real initialization, buffers, envelopes and filters through
      // Chrome's audio renderer; intercept only the context constructor.
      try{window.AudioContext=function(){return offline;};bank.unlock();}finally{window.AudioContext=RealAudioContext;}
      if(isLoop){
        bank.setContinuous(kind,true,1.4);
        void offline.suspend(.35).then(()=>{bank.setContinuous(kind,false);return offline.resume();});
      }else bank.play(kind,1.5);
      const rendered=await offline.startRendering();results.push({kind,isLoop,...measure(rendered.getChannelData(0))});
    }
    return results;
  });
  for(const waveform of waveforms){
    assert(waveform.peak>.005&&waveform.peak<.5,`${waveform.kind}: nonzero waveform with comfortable clipping headroom`);
    assert(waveform.rms>.0005,`${waveform.kind}: non-silent rendered sound`);
    assert(waveform.tailRms<.00002,`${waveform.kind}: event or released loop decays to silence`);
    if(!waveform.isLoop)assert(waveform.bassRatio<.12,`${waveform.kind}: no bass-heavy drum resonance`);
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,context:active.contextState,oneShots:active.events,loops:Object.keys(active.activeLoops),loopTransitions:stopped.loopTransitions,waveforms}));
}finally{await context.close();await browser.close();}
