const $=id=>document.getElementById(id),frame=$('game'),panel=$('panel');
const gameURL=new URL('../../',location.href);
// The same route and existing device settings are used; no quality overrides.
for(const key of ['renderer','level'])if(new URL(location.href).searchParams.has(key))gameURL.searchParams.set(key,new URL(location.href).searchParams.get(key));
frame.src=gameURL.href;
let active=false,game=null,report=null,timer=null,originalStep,originalDraw,wrappedStep,wrappedDraw,pendingCPU=0,last=0,first=0;
let samples=[],events=[],errors=[],disposers=[],startedAt=0,activeStep=null;
const number=value=>Math.round(value*10)/10;
const stats=values=>{
 if(!values.length)return null;
 const sorted=[...values].sort((a,b)=>a-b),mean=values.reduce((a,b)=>a+b,0)/values.length;
 return {count:values.length,meanMs:number(mean),fps:number(1000/mean),p95Ms:number(sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*.95)-1)]),maxMs:number(sorted.at(-1)),over50ms:values.filter(v=>v>50).length};
};
function area(){
 const p=game.player,y=p.camera.position.y-p.eyeHeight,x=p.camera.position.x,z=p.camera.position.z;
 if(y< -5)return 'B2';if(y< -1)return 'B1';if(y>1)return `L${Math.min(4,Math.max(1,Math.round(y/3.3)))}`;
 if(x>9&&z>6&&z<16)return 'Αυλή';if(z>5&&x<9)return 'Φουαγιέ / σκάλα';if(Math.abs(x)<4&&Math.abs(z)<4)return 'Αρχικό δωμάτιο';return 'Εξωτερικός χώρος';
}
function note(type,detail=''){
 events.push({atMs:number(performance.now()-startedAt),type,detail});
 if(['hidden','visible','freeze','resume'].includes(type)){last=0;pendingCPU=0;}
}
function finish(){
 if(!active)return;
 active=false;clearInterval(timer);timer=null;
 if(game.step===wrappedStep)game.step=originalStep;
 if(game.renderer.drawScene===wrappedDraw)game.renderer.drawScene=originalDraw;
 for(const dispose of disposers)dispose();disposers=[];
 const renderer=game.renderer,canvas=renderer.webgl.domElement,backend=renderer.webgl.backend;
 const byArea=Object.fromEntries([...new Set(samples.map(s=>s.area))].map(name=>[name,stats(samples.filter(s=>s.area===name).map(s=>s.frameMs))]));
 report={schema:1,createdAt:new Date().toISOString(),gameURL:gameURL.href,buildScripts:[...frame.contentDocument.querySelectorAll('script[src]')].map(s=>s.src),device:{userAgent:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight},devicePixelRatio,canvas:{width:canvas.width,height:canvas.height},backend:backend.isWebGLBackend?'WebGL2':'WebGPU'},durationMs:number(performance.now()-startedAt),method:'Completed scene submissions; wall-clock interval and synchronous JavaScript CPU only, not isolated GPU time. Game settings and camera remain unchanged. Background transitions excluded from frame gaps and recorded as events.',frames:stats(samples.map(s=>s.frameMs)),cpu:stats(samples.map(s=>s.cpuMs)),byArea,errors:[...errors,...renderer.renderError?[renderer.renderError]:[]],events,samples};
 panel.classList.remove('compact');$('stop').hidden=true;$('begin').hidden=false;$('begin').textContent='Νέα καταγραφή';$('results').hidden=false;$('download').hidden=!samples.length;$('copy').hidden=!samples.length;
 $('status').textContent=samples.length?'Η καταγραφή ολοκληρώθηκε.':'Δεν καταγράφηκαν εικόνες παιχνιδιού. Πάτησε START και ξαναδοκίμασε.';
 const s=report.frames;$('summary').textContent=s?`${s.fps} FPS · ${s.count} καρέ\nP95: ${s.p95Ms} ms · μέγιστο: ${s.maxMs} ms\n${s.over50ms} καρέ πάνω από 50 ms`:'Χωρίς δείγματα.';
 $('rows').replaceChildren();for(const [name,s]of Object.entries(byArea)){const row=document.createElement('tr');for(const text of [name,s.fps,`${s.p95Ms} / ${s.maxMs} ms`]){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}$('rows').append(row);}
}
function start(){
 if(!game||active)return;
 active=true;report=null;samples=[];events=[];errors=[];pendingCPU=0;last=0;first=0;startedAt=performance.now();
 panel.classList.add('compact');$('stop').hidden=false;$('results').hidden=true;
 originalStep=game.step;originalDraw=game.renderer.drawScene;
 wrappedStep=function(...args){
  const current={begin:performance.now(),previousCPU:pendingCPU,drawn:false,sample:null};activeStep=current;
  try{return originalStep.apply(this,args);}finally{
   const elapsed=performance.now()-current.begin;
   if(current.drawn){if(current.sample)current.sample.cpuMs=number(current.previousCPU+elapsed);pendingCPU=0;}
   else pendingCPU+=elapsed;
   activeStep=null;
  }
 };
 wrappedDraw=function(...args){
  const began=performance.now(),cpuBeforeDraw=pendingCPU;
  try{return originalDraw.apply(this,args);}finally{
   const now=performance.now();if(active&&game.started&&!document.hidden&&!frame.contentDocument.hidden){
    if(!first){first=now;note('first-game-frame');}
    if(last&&samples.length<30000){const p=game.player.camera.position,sample={atMs:number(now-startedAt),frameMs:number(now-last),cpuMs:number(cpuBeforeDraw+now-began),area:area(),position:[number(p.x),number(p.y),number(p.z)],tool:game.selectedTool,drawCalls:game.renderer.webgl.info.render.calls,triangles:game.renderer.webgl.info.render.triangles};samples.push(sample);if(activeStep)activeStep.sample=sample;}
    last=now;
   }
   if(activeStep)activeStep.drawn=true;
   pendingCPU=0;
  }
 };
 game.step=wrappedStep;game.renderer.drawScene=wrappedDraw;
 const listen=(target,type,handler)=>{target.addEventListener(type,handler);disposers.push(()=>target.removeEventListener(type,handler));};
 listen(document,'visibilitychange',()=>note(document.hidden?'hidden':'visible'));
 listen(frame.contentDocument,'visibilitychange',()=>note(frame.contentDocument.hidden?'hidden':'visible'));
 for(const type of ['freeze','resume'])listen(frame.contentDocument,type,()=>note(type));
 listen(frame.contentWindow,'error',event=>{errors.push(String(event.message));note('error',String(event.message));});
 listen(frame.contentWindow,'unhandledrejection',event=>{errors.push(String(event.reason));note('unhandledrejection',String(event.reason));});
 note('recording-started');
 timer=setInterval(()=>{
  if(!first)$('status').textContent='Πάτησε START στο παιχνίδι';
  else{const seconds=Math.max(0,120-Math.floor((performance.now()-first)/1000));$('status').textContent=`Καταγραφή · ${seconds}s`;
   if(seconds===0||samples.length>=30000)finish();}
 },1000);
 $('status').textContent=game.started?'Καταγραφή · 120s':'Πάτησε START στο παιχνίδι';
}
$('begin').onclick=start;$('stop').onclick=finish;
$('close').onclick=()=>location.assign(gameURL.href);
$('download').onclick=async()=>{
 if(!report)return;
 const file=new File([JSON.stringify(report,null,2)],`electrical-game-performance-${Date.now()}.json`,{type:'application/json'});
 if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:'Electrical-Game performance'});return;}catch(error){if(error.name==='AbortError')return;}}
 const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
};
$('copy').onclick=async()=>{if(!report?.frames)return;try{await navigator.clipboard.writeText(`${navigator.userAgent}\n${$('summary').textContent}\n${Object.entries(report.byArea).map(([name,s])=>`${name}: ${s.fps} FPS, P95 ${s.p95Ms}ms, max ${s.maxMs}ms`).join('\n')}`);$('status').textContent='Οι αριθμοί αντιγράφηκαν.';}catch{$('status').textContent='Η αντιγραφή δεν επιτράπηκε. Χρησιμοποίησε την αποθήκευση αναφοράς.';}};
const wait=setInterval(()=>{
 try{const g=frame.contentWindow.__wireTheHouse;if(!g?.isReadyForStart)return;game=g;clearInterval(wait);$('begin').disabled=false;$('status').textContent='Έτοιμο για καταγραφή.';}catch{$('status').textContent='Δεν μπορούμε να διαβάσουμε το παιχνίδι. Άνοιξε αυτή τη σελίδα από τον ίδιο ιστότοπο.';clearInterval(wait);}
},500);
// Read-only access for the local acceptance check; no generated performance data.
window.performanceRecording={start,finish,get report(){return report;},get active(){return active;}};
