import { chromium } from 'playwright';

const urls=process.argv.slice(2);
if(!urls.length)throw Error('Pass one or more game URLs.');
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
try{
  for(const url of urls){
    const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
    await page.goto(`${url}${url.includes('?')?'&':'?'}renderer=webgl`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__wireTheHouse&&!document.querySelector('#start-button')?.disabled,{timeout:30000});
    await page.click('#start-button');
    const result=await page.evaluate(async()=>{
      const g=window.__wireTheHouse,r=g.renderer,b=r.webgl.backend;
      await g.room.brickWall.waitForGeometry();await g.mortar.waitForGeometry();
      const fence=async()=>{if(b.gl)b.gl.finish();};
      const samples=[],calls=[],triangles=[];
      for(let i=0;i<12;i++){r.render();await r.waitForFrame();await fence();}
      for(let i=0;i<45;i++){
        const started=performance.now();r.render();await r.waitForFrame();await fence();samples.push(performance.now()-started);
        calls.push(r.webgl.info.render.calls);triangles.push(r.webgl.info.render.triangles);
      }
      samples.sort((a,b)=>a-b);
      return{meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,p95Ms:samples[Math.floor(samples.length*.95)],calls:Math.max(...calls),triangles:Math.max(...triangles),error:r.renderError};
    });
    results.push({url,...result});await page.close();
  }
}finally{await browser.close();}
console.log(JSON.stringify(results,null,2));
