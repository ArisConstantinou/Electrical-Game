const $=id=>document.getElementById(id),frame=$('game'),panel=$('panel');
const gameURL=new URL('../../',location.href);
// The same route and existing device settings are used; no quality overrides.
for(const key of ['renderer','level'])if(new URL(location.href).searchParams.has(key))gameURL.searchParams.set(key,new URL(location.href).searchParams.get(key));
frame.src=gameURL.href;
let active=false,game=null,report=null,timer=null,originalStep,originalDraw,wrappedStep,wrappedDraw,pendingCPU=0,last=0,first=0;
let samples=[],events=[],errors=[],disposers=[],startedAt=0,activeStep=null;
let diagnostics=[],heartbeat=0,heartbeatAt=0,heartbeatRequest=0,visibleMs=0,visibleAt=0,presentations=0,stallAt=0,longestGap=0;
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
 if(['hidden','visible','freeze','resume'].includes(type)){accountTime();last=0;pendingCPU=0;visibleAt=0;stallAt=0;}
}
const eligible=()=>game.started&&!document.hidden&&!frame.contentDocument.hidden&&!game.lifecyclePaused;
function accountTime(){const now=performance.now();if(visibleAt)visibleMs+=now-visibleAt;visibleAt=first&&eligible()?now:0;}
function snapshot(){
 accountTime();const now=performance.now(),gap=last&&eligible()?now-last:0;longestGap=Math.max(longestGap,gap);
 const state={atMs:number(now-startedAt),area:area(),gapMs:number(gap),childAnimationFrames:heartbeat,childAnimationGapMs:heartbeatAt?number(now-heartbeatAt):null,parentVisibility:document.visibilityState,gameVisibility:frame.contentDocument.visibilityState,game:{started:game.started,ready:game.isReadyForStart,paused:game.lifecyclePaused,animationFrame:game.animationFrame,waterPreparing:!!game.waterProTask,generation:game.lifecycleGeneration},renderer:{pending:game.renderer.framePending,error:game.renderer.renderError,...game.renderer.lifecycleTelemetry}};
 if(diagnostics.length<240)diagnostics.push(state);
 if(gap>2000&&!stallAt){stallAt=last;note('rendering-stalled',state);}
 if(gap<=2000&&stallAt){note('rendering-recovered',{gapMs:number(now-stallAt)});stallAt=0;}
 return state;
}
function finish(){
 if(!active)return;
 const finalState=snapshot();
 active=false;clearInterval(timer);timer=null;
 frame.contentWindow.cancelAnimationFrame(heartbeatRequest);
 if(game.step===wrappedStep)game.step=originalStep;
 if(game.renderer.drawScene===wrappedDraw)game.renderer.drawScene=originalDraw;
 for(const dispose of disposers)dispose();disposers=[];
 const renderer=game.renderer,canvas=renderer.webgl.domElement,backend=renderer.webgl.backend;
 const byArea=Object.fromEntries([...new Set(samples.map(s=>s.area))].map(name=>[name,stats(samples.filter(s=>s.area===name).map(s=>s.frameMs))]));
 report={schema:2,createdAt:new Date().toISOString(),gameURL:gameURL.href,buildScripts:[...frame.contentDocument.querySelectorAll('script[src]')].map(s=>s.src),device:{userAgent:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight},devicePixelRatio,canvas:{width:canvas.width,height:canvas.height},backend:backend.isWebGLBackend?'WebGL2':'WebGPU'},durationMs:number(performance.now()-startedAt),visiblePlayingMs:number(visibleMs),effectiveFPS:visibleMs?number(presentations*1000/visibleMs):null,longestPresentationGapMs:number(longestGap),finalState,diagnostics,method:'Successful scene submissions, not isolated GPU completion. Interval statistics describe received frames only. Effective FPS includes time without new submissions while visible and playing, including a frozen tail. Paused/background time is excluded. One independent child animation heartbeat and one diagnostic snapshot per second.',frames:stats(samples.map(s=>s.frameMs)),cpu:stats(samples.map(s=>s.cpuMs)),byArea,errors:[...errors,...renderer.renderError?[renderer.renderError]:[]],events,samples};
 panel.classList.remove('compact');panel.classList.add('completed');$('stop').hidden=true;$('begin').hidden=false;$('begin').textContent='Νέα καταγραφή';$('results').hidden=false;$('download').hidden=!samples.length;$('copy').hidden=!samples.length;
 $('status').textContent=finalState.gapMs>2000?'Το παιχνίδι σταμάτησε να δίνει νέα καρέ. Η διάγνωση αποθηκεύτηκε.':samples.length?'Η καταγραφή ολοκληρώθηκε.':'Δεν καταγράφηκαν εικόνες παιχνιδιού. Πάτησε START και ξαναδοκίμασε.';
 const s=report.frames;$('summary').textContent=s?`${report.effectiveFPS} FPS συνολικά · ${s.count} διαστήματα καρέ\nΚαρέ που ελήφθησαν: ${s.fps} FPS\nP95: ${s.p95Ms} ms · μέγιστο: ${s.maxMs} ms\n${s.over50ms} καρέ πάνω από 50 ms\nΜεγαλύτερο διάστημα χωρίς νέο καρέ: ${number(longestGap/1000)} s`:'Χωρίς δείγματα.';
 $('rows').replaceChildren();for(const [name,s]of Object.entries(byArea)){const row=document.createElement('tr');for(const text of [name,s.fps,`${s.p95Ms} / ${s.maxMs} ms`]){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}$('rows').append(row);}
}
function start(){
 if(!game||active)return;
 active=true;report=null;samples=[];events=[];errors=[];pendingCPU=0;last=0;first=0;startedAt=performance.now();
 diagnostics=[];heartbeat=0;heartbeatAt=0;visibleMs=0;visibleAt=0;presentations=0;stallAt=0;longestGap=0;
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
  const result=originalDraw.apply(this,args);
  {
   const now=performance.now();if(active&&game.started&&!document.hidden&&!frame.contentDocument.hidden){
    if(!first){first=now;visibleAt=now;note('first-game-frame');}presentations++;
    if(last)longestGap=Math.max(longestGap,now-last);
    if(last&&samples.length<30000){const p=game.player.camera.position,sample={atMs:number(now-startedAt),frameMs:number(now-last),cpuMs:number(cpuBeforeDraw+now-began),area:area(),position:[number(p.x),number(p.y),number(p.z)],tool:game.selectedTool,drawCalls:game.renderer.webgl.info.render.calls,triangles:game.renderer.webgl.info.render.triangles};samples.push(sample);if(activeStep)activeStep.sample=sample;}
    last=now;
   }
   if(activeStep)activeStep.drawn=true;
   pendingCPU=0;
  }
  return result;
 };
 game.step=wrappedStep;game.renderer.drawScene=wrappedDraw;
 const listen=(target,type,handler)=>{target.addEventListener(type,handler);disposers.push(()=>target.removeEventListener(type,handler));};
 listen(document,'visibilitychange',()=>note(document.hidden?'hidden':'visible'));
 listen(frame.contentDocument,'visibilitychange',()=>note(frame.contentDocument.hidden?'hidden':'visible'));
 for(const type of ['freeze','resume'])listen(frame.contentDocument,type,()=>note(type));
 listen(frame.contentWindow,'error',event=>{errors.push(String(event.message));note('error',String(event.message));});
 listen(frame.contentWindow,'unhandledrejection',event=>{errors.push(String(event.reason));note('unhandledrejection',String(event.reason));});
 for(const type of ['webglcontextlost','webglcontextrestored'])listen(game.renderer.webgl.domElement,type,()=>note(type));
 listen(frame.contentWindow,'wirehouse:graphics-lost',()=>note('graphics-lost'));
 const beat=()=>{if(!active)return;heartbeat++;heartbeatAt=performance.now();heartbeatRequest=frame.contentWindow.requestAnimationFrame(beat);};
 heartbeatRequest=frame.contentWindow.requestAnimationFrame(beat);
 note('recording-started');
 timer=setInterval(()=>{
  const state=snapshot();
  if(!first)$('status').textContent='Πάτησε START στο παιχνίδι';
  else{const seconds=Math.max(0,120-Math.floor((performance.now()-first)/1000));$('status').textContent=state.gapMs>2000?`Πάγωμα · ${Math.floor(state.gapMs/1000)}s χωρίς καρέ`:game.lifecyclePaused?'Το παιχνίδι είναι σε παύση':`Καταγραφή · ${seconds}s`;
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
$('copy').onclick=async()=>{if(!report?.frames)return;try{await navigator.clipboard.writeText(`${navigator.userAgent}\n${report.device.backend} · ${report.device.canvas.width}×${report.device.canvas.height}\nΈκδοση: ${report.buildScripts.join(', ')}\n${$('summary').textContent}\n${Object.entries(report.byArea).map(([name,s])=>`${name}: ${s.fps} FPS, P95 ${s.p95Ms}ms, max ${s.maxMs}ms`).join('\n')}\nΔιάγνωση: ${JSON.stringify(report.finalState)}\nΣφάλματα: ${JSON.stringify(report.errors)}`);$('status').textContent='Οι αριθμοί και η διάγνωση αντιγράφηκαν.';}catch{$('status').textContent='Η αντιγραφή δεν επιτράπηκε. Χρησιμοποίησε την αποθήκευση αναφοράς.';}};
const wait=setInterval(()=>{
 try{const g=frame.contentWindow.__wireTheHouse;if(!g?.isReadyForStart)return;game=g;clearInterval(wait);$('begin').disabled=false;$('status').textContent='Έτοιμο για καταγραφή.';}catch{$('status').textContent='Δεν μπορούμε να διαβάσουμε το παιχνίδι. Άνοιξε αυτή τη σελίδα από τον ίδιο ιστότοπο.';clearInterval(wait);}
},500);
// Read-only access for the local acceptance check; no generated performance data.
window.performanceRecording={start,finish,get report(){return report;},get active(){return active;}};
