import {number,stats,worstWindow} from './metrics.js?v=diagnostics-4';
import {createTour} from './tour.js?v=diagnostics-4';
import {RECORDER_VERSION,coverage,compareVisits,diagnose,supportFor,appendResourceSnapshot} from './diagnostics.js?v=diagnostics-4';
import {observeMainThread} from './observers.js?v=diagnostics-4';
import {createFunctionalChecks} from './functional.js?v=diagnostics-4';
const $=id=>document.getElementById(id),frame=$('game'),panel=$('panel');
const gameURL=new URL('../../',location.href);
for(const key of ['renderer','level','v'])if(new URL(location.href).searchParams.has(key))gameURL.searchParams.set(key,new URL(location.href).searchParams.get(key));
let active=false,game=null,report=null,timer=null,startedAt=0,run=0,tour=null;
let phase='loading',functional=null,functionalAt=0,functionalHiddenAt=0,resourceSamples=[],tasks=[],observer=null,support={},overhead={tourCpuMs:0,recorderCpuMs:0,monitorCpuMs:0},panelUpdatedAt=-Infinity;
let samples=[],events=[],errors=[],diagnostics=[],checkpoints=[],captures=[],hudSamples=[],segments=[],loading={},settings={};
let disposers=[],pendingCPU=0,last=0,first=0,activeStep=null,visibleMs=0,visibleAt=0,presentations=0,longestGap=0,stallAt=0;
let heartbeat=0,heartbeatAt=0,heartbeatRequest=0,currentSegment=null,currentDocument=null,previousDocument=null,bootAttempted=false;
let lastCaptureAt=-Infinity,captureRequest=null,captureJob=false,captureBytes=0,captureCost=0,captureNextMs=0,captureFailure='',hudFPS=null,restoreRuntime=()=>{},hiddenAt=0,loadingHiddenMs=0;
const elapsed=()=>performance.now()-startedAt;
const runtimeEligible=()=>!!game?.started&&!document.hidden&&!frame.contentDocument?.hidden&&!game.lifecyclePaused;
const eligible=()=>runtimeEligible()&&phase==='performance';
function accountTime(){const now=performance.now();if(visibleAt)visibleMs+=now-visibleAt;visibleAt=first&&eligible()?now:0;}
function closeSegment(){if(currentSegment){currentSegment.end=elapsed();currentSegment=null;}}
function note(type,detail=''){
 events.push({atMs:number(elapsed()),type,detail});
 if(['hidden','visible','freeze','resume'].includes(type)){accountTime();closeSegment();last=0;pendingCPU=0;visibleAt=0;stallAt=0;}
}
function listen(target,type,handler,options){target.addEventListener(type,handler,options);disposers.push(()=>target.removeEventListener(type,handler,options));}
function resourceSnapshot(kind,pass=tour?.current?.pass){
 if(!game)return;const info=game.renderer.webgl.info,memory=frame.contentWindow.performance.memory;
 appendResourceSnapshot(resourceSamples,{atMs:number(elapsed()),kind,phase,pass,roomId:tour?.current?.roomId,geometries:info.memory.geometries,textures:info.memory.textures,heapBytes:memory?.usedJSHeapSize??null,heapLimitBytes:memory?.jsHeapSizeLimit??null});
}
function positionPanel(){
 if(!panel.classList.contains('compact'))return;let bottom=0;
 for(const id of ['fps-counter','mobile-top-rail','mobile-tool-slider']){const e=frame.contentDocument?.getElementById(id),r=e?.getBoundingClientRect();if(r?.width&&r.height&&getComputedStyle(e).visibility!=='hidden')bottom=Math.max(bottom,r.bottom);}
 panel.style.setProperty('--benchmark-top',Math.ceil(Math.max(12,bottom+10))+'px');
}
function beginFunctional(){
 if(!active)return;accountTime();closeSegment();phase='functional';last=0;visibleAt=0;pendingCPU=0;note('functional-started');resourceSnapshot('performance-end');
 functionalAt=performance.now();functionalHiddenAt=loadingHiddenMs;functional=createFunctionalChecks(game,()=>queueMicrotask(()=>finish('completed')));
}
function area(){
 if(!game)return 'Φόρτωση';
 if(phase==='performance'&&tour?.current?.roomId)return tour.current.label;
 const p=game.player,y=p.camera.position.y-p.eyeHeight,x=p.camera.position.x,z=p.camera.position.z;
 if(y< -5)return 'B2';if(y< -1)return 'B1';if(y>1)return `L${Math.min(4,Math.max(1,Math.round(y/3.3)))}`;
 if(x>9&&z>6&&z<16)return 'Αυλή';if(z>5&&x<9)return 'Φουαγιέ / σκάλα';if(Math.abs(x)<4&&Math.abs(z)<4)return 'Αρχικό δωμάτιο';return 'Εξωτερικός χώρος';
}
function snapshot(){
 accountTime();const now=performance.now(),gap=last&&eligible()?now-last:0;longestGap=Math.max(longestGap,gap);
 const state={atMs:number(elapsed()),area:area(),phase,checkpoint:(functional??tour)?.current?.label,roomId:tour?.current?.roomId,pass:tour?.current?.pass,position:game?.player.camera.position.toArray().map(number),gapMs:number(gap),childAnimationFrames:heartbeat,childAnimationGapMs:heartbeatAt?number(now-heartbeatAt):null,parentVisibility:document.visibilityState,gameVisibility:frame.contentDocument?.visibilityState,game:game?{started:game.started,ready:game.isReadyForStart,paused:game.lifecyclePaused,animationFrame:game.animationFrame,waterPreparing:!!game.waterProTask,generation:game.lifecycleGeneration}:null,renderer:game?{pending:game.renderer.framePending,error:game.renderer.renderError,...game.renderer.lifecycleTelemetry}:null};
 if(diagnostics.length<1800)diagnostics.push(state);
 if(gap>2000&&!stallAt){stallAt=last;note('rendering-stalled',state);captureRequest={reason:'Χωρίς νέα καρέ',frameMs:gap};}
 if(gap<=2000&&stallAt){note('rendering-recovered',{gapMs:number(now-stallAt)});stallAt=0;}
 return state;
}
// Bounded event-driven thumbnails; no continuous video encoder or readback loop.
// Drawing and JPEG encoding costs remain visible in raw metrics and are labelled.
function capture(reason,frameMs=0,sample=null){
 if(!active||!game||captureFailure||captureJob||elapsed()-lastCaptureAt<3000)return;
 const source=game.renderer.webgl.domElement;
 if(!game.renderer.webgl.backend.device||typeof createImageBitmap!=='function'){copyCapture(reason,frameMs,sample);return;}
 // Snapshot while the WebGPU texture is valid, then copy/encode the retained
 // bitmap outside Game.step. Waiting for the queue can lose that texture.
 const generation=run,begin=performance.now(),sourceMeta=captureMeta();captureJob=true;
 let image;
 try{image=createImageBitmap(source);}catch(error){captureJob=false;copyCapture(reason,frameMs,sample);return;}
 const cost=performance.now()-begin;sourceMeta.snapshotCpuMs=number(cost);captureCost+=cost;captureNextMs+=cost;if(sample)sample.captureCpuMs=number(cost);
 image.then(bitmap=>{
  try{if(active&&run===generation)copyCapture(reason,frameMs,null,bitmap,sourceMeta);}finally{bitmap.close();}
 }).catch(error=>{if(active&&run===generation){captureFailure=String(error);note('capture-unavailable',captureFailure);}}).finally(()=>{if(run===generation){captureJob=false;if(cost>32&&!captureFailure){captureFailure=`Οι επόμενες λήψεις σταμάτησαν επειδή το στιγμιότυπο κόστισε ${number(cost)} ms.`;note('capture-budget-exceeded',{cpuMs:number(cost)});}}});
}
function captureMeta(){return {sourceAtMs:number(elapsed()),phase,pass:tour?.current?.pass,roomId:tour?.current?.roomId,checkpoint:tour?.current?.label,area:area(),position:game.player.camera.position.toArray().map(number),yaw:number(game.player.yaw),pitch:number(game.player.pitch)};}
function copyCapture(reason,frameMs=0,sample=null,retainedImage=null,sourceMeta=null){
 if(!active||!game||captureFailure||elapsed()-lastCaptureAt<3000)return;
 const before=performance.now();lastCaptureAt=elapsed();
 try{
  const source=retainedImage??game.renderer.webgl.domElement,canvas=document.createElement('canvas');
  canvas.width=Math.min(320,source.width);canvas.height=Math.round(source.height*canvas.width/source.width);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0,canvas.width,canvas.height);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  let lit=0;for(let i=0;i<pixels.length;i+=64)if(pixels[i]+pixels[i+1]+pixels[i+2]>24)lit++;
  if(!lit){note('capture-unavailable','Ο browser επέστρεψε κενή εικόνα. Οι μετρήσεις συνεχίζονται.');captureFailure='Ο browser δεν επέτρεψε χρήσιμη λήψη του καμβά.';return;}
  const dataURL=canvas.toDataURL('image/jpeg',.65),cost=performance.now()-before;
  const item={atMs:number(elapsed()),reason,frameMs:number(frameMs),area:area(),checkpoint:tour?.current?.label,position:game.player.camera.position.toArray().map(number),yaw:number(game.player.yaw),pitch:number(game.player.pitch),width:canvas.width,height:canvas.height,captureCpuMs:number(cost+(sourceMeta?.snapshotCpuMs??0)),dataURL,...(sourceMeta??captureMeta())};
  // Keep the strongest events plus route views, bounded to 18 thumbnails / 3 MB.
  if(captures.length>=18){const weakest=captures.reduce((best,c,i)=>c.frameMs<captures[best].frameMs?i:best,0);if(frameMs<=captures[weakest].frameMs)return;captureBytes-=captures[weakest].dataURL.length;captures.splice(weakest,1);}
  if(captureBytes+dataURL.length>3*1024*1024){note('capture-limit','Οι εικόνες έφτασαν το όριο αποθήκευσης.');return;}
  captureBytes+=dataURL.length;captures.push(item);
 }catch(error){captureFailure=String(error);note('capture-unavailable',captureFailure);}
 finally{const cost=performance.now()-before,totalCost=cost+(sourceMeta?.snapshotCpuMs??0);captureCost+=cost;captureNextMs+=cost;if(sample)sample.captureCpuMs=number(cost);if(totalCost>32&&!captureFailure){captureFailure=`Οι επόμενες λήψεις σταμάτησαν επειδή μία λήψη κόστισε συνολικά ${number(totalCost)} ms.`;note('capture-budget-exceeded',{cpuMs:number(totalCost)});}}
}
function installRuntime(g){
 game=g;const originalStep=g.step,originalDraw=g.renderer.drawScene,originalFps=g.hud.updateFps;
 const wrappedFps=function(value){hudFPS=Math.max(0,Math.round(value));if(active&&eligible())hudSamples.push({atMs:number(elapsed()),phase,fps:hudFPS,rawFPS:number(value),area:area(),checkpoint:tour?.current?.label});return originalFps.call(this,value);};
 const wrappedStep=function(...args){
  const automationBegin=performance.now();if(active&&runtimeEligible()){if(phase==='performance')tour?.update(args[0]);else if(phase==='functional')functional?.update(args[0]);}overhead.tourCpuMs+=performance.now()-automationBegin;
  const current={begin:performance.now(),previousCPU:pendingCPU,drawn:false,sample:null};activeStep=current;
  try{return originalStep.apply(this,args);}finally{const spent=performance.now()-current.begin;if(current.drawn){if(current.sample)current.sample.cpuMs=number(current.previousCPU+spent);pendingCPU=0;}else pendingCPU+=spent;activeStep=null;if(phase==='functional')functional?.afterStep();}
 };
 const wrappedDraw=function(...args){
  const began=performance.now(),cpuBefore=pendingCPU,shadowRequested=!!g.room.sun?.shadow.needsUpdate;
  const result=originalDraw.apply(this,args),renderCpuMs=performance.now()-began,recorderBegin=performance.now();
  if(active&&eligible()){
   const now=performance.now(),at=elapsed();
   if(!first){first=now;visibleAt=now;loading.firstGameFrameMs=number(at);note('first-game-frame');}
   if(!currentSegment){currentSegment={start:at,end:at,times:[]};segments.push(currentSegment);}
   currentSegment.times.push(at);currentSegment.end=at;presentations++;
   if(last)longestGap=Math.max(longestGap,now-last);
   let sample=null;
   if(last){const p=g.player.camera.position,info=g.renderer.webgl.info;sample={atMs:number(at),frameMs:number(now-last),cpuMs:number(cpuBefore+now-began),instantFPS:number(1000/(now-last)),hudFPS,area:area(),checkpoint:tour?.current?.label,position:[number(p.x),number(p.y),number(p.z)],yaw:number(g.player.yaw),pitch:number(g.player.pitch),tool:g.selectedTool,phase,pass:tour?.current?.pass,roomId:tour?.current?.roomId,inspectionSweep:!!tour?.inspecting,renderCpuMs:number(renderCpuMs),drawCalls:info.render.calls,triangles:info.render.triangles,geometries:info.memory.geometries,textures:info.memory.textures,shadowRequested,previousCaptureCpuMs:number(captureNextMs)};captureNextMs=0;samples.push(sample);if(activeStep)activeStep.sample=sample;}
   last=now;
   if(sample?.frameMs>=100)capture('Καθυστέρηση καρέ',sample.frameMs,sample);
   else if(captureRequest){capture(captureRequest.reason,captureRequest.frameMs,sample);captureRequest=null;}
   if(samples.length>=180000)queueMicrotask(()=>finish('capacity-limit'));
  }
  overhead.recorderCpuMs+=performance.now()-recorderBegin;if(activeStep)activeStep.drawn=true;pendingCPU=0;return result;
 };
 g.step=wrappedStep;g.renderer.drawScene=wrappedDraw;g.hud.updateFps=wrappedFps;
 restoreRuntime=()=>{if(g.step===wrappedStep)g.step=originalStep;if(g.renderer.drawScene===wrappedDraw)g.renderer.drawScene=originalDraw;if(g.hud.updateFps===wrappedFps)g.hud.updateFps=originalFps;};
 const beat=()=>{if(!active)return;heartbeat++;heartbeatAt=performance.now();heartbeatRequest=frame.contentWindow.requestAnimationFrame(beat);};
 heartbeatRequest=frame.contentWindow.requestAnimationFrame(beat);
 settings={apprentices:frame.contentDocument.querySelector('#apprentice-count')?.value,tool:g.selectedTool};
 tour=createTour(g,checkpoint=>{
  checkpoints.push({atMs:number(elapsed()),...checkpoint});
  if(checkpoint.kind==='view')resourceSnapshot('view',checkpoint.pass);
  if(checkpoint.label==='Τέλος περάσματος')resourceSnapshot('pass-end',checkpoint.pass);
  if(checkpoint.kind==='view')captureRequest={reason:checkpoint.label,frameMs:0};
 },()=>queueMicrotask(beginFunctional),failure=>{note('tour-blocked',failure);captureRequest={reason:'Εμπόδιο στη διαδρομή',frameMs:0};queueMicrotask(()=>finish('blocked'));});
 listen(g.renderer.webgl.domElement,'webglcontextlost',()=>{note('webglcontextlost');captureRequest={reason:'Απώλεια γραφικών',frameMs:0};});
 listen(g.renderer.webgl.domElement,'webglcontextrestored',()=>note('webglcontextrestored'));
 listen(frame.contentWindow,'wirehouse:graphics-lost',()=>note('graphics-lost'));
 note('game-ready');loading.readyMs=number(elapsed());resourceSnapshot('ready');
 if(!g.room.mansionWing||gameURL.searchParams.has('level')){note('unsupported-route','Η σταθερή διαδρομή απαιτεί το αρχικό mansion.');finish('unsupported-route');return;}
 loading.startRequestedMs=number(elapsed());phase='performance';frame.contentDocument.querySelector('#start-button').click();positionPanel();
}
function monitor(){
 if(!active)return;
 try{
  const doc=frame.contentDocument;
  if(!doc||doc===previousDocument)return; // A slow reload must not attach the preceding game's runtime.
  if(doc&&doc!==currentDocument&&doc.URL!=='about:blank'){
   currentDocument=doc;observer?.close();observer=observeMainThread(frame.contentWindow,performance.timeOrigin+startedAt,()=>phase,tasks);support=observer.support;
   listen(doc,'visibilitychange',()=>note(doc.hidden?'hidden':'visible'));
   for(const type of ['freeze','resume'])listen(doc,type,()=>note(type));
   listen(frame.contentWindow,'error',event=>{const message=String(event.message||event.target?.src||'Resource load failed');errors.push(message);note('error',message);captureRequest={reason:'Σφάλμα',frameMs:0};},true);
   listen(frame.contentWindow,'unhandledrejection',event=>{errors.push(String(event.reason));note('unhandledrejection',String(event.reason));});
  }
  if(!loading.menuVisibleMs&&doc?.querySelector('#start-screen')){loading.menuVisibleMs=number(elapsed());note('menu-visible');}
  const progress=doc?.querySelector('#start-load-percent')?.value;
  if(progress&&progress!==loading.progress?.at(-1)?.value)(loading.progress??=[]).push({atMs:number(elapsed()),value:progress});
  if(!game){
   $('status').textContent=`Φόρτωση παιχνιδιού${progress?' · '+progress:''}`;
   if(progress==='LOAD FAILED'){finish('load-failed');return;}
   const g=frame.contentWindow.__wireTheHouse;
   if(g?.isReadyForStart&&!bootAttempted){bootAttempted=true;installRuntime(g);}
   if(elapsed()-loadingHiddenMs>180000&&!document.hidden)finish('load-timeout');
   return;
  }
  if(elapsed()-panelUpdatedAt>1000){positionPanel();panelUpdatedAt=elapsed();}
  const gap=last&&eligible()?performance.now()-last:0;
  $('status').textContent=gap>2000?`Πάγωμα · ${Math.floor(gap/1000)}s χωρίς καρέ`:game.lifecyclePaused||document.hidden?'Σε παύση · η διαδρομή θα συνεχιστεί':phase==='functional'?`Έλεγχοι · ${functional?.current?.label??''}`:`Πέρασμα ${tour.current?.pass??2}/2 · ${tour.current?.label??'Ολοκλήρωση'} · ${Math.round(tour.index/tour.total*100)}%`;
  $('route-progress').value=tour.index/tour.total;
  if(phase==='functional'&&performance.now()-functionalAt-(loadingHiddenMs-functionalHiddenAt)-(document.hidden&&hiddenAt?performance.now()-hiddenAt:0)>60000){note('functional-timeout',functional?.current);finish('functional-timeout');return;}
  if(gap>15000){capture('Χωρίς νέα καρέ',gap);finish('render-stalled');}
 }catch(error){errors.push(String(error));finish('load-failed');}
}
function start(){
 if(active)return;run++;active=true;game=null;report=null;tour=null;startedAt=performance.now();
 samples=[];events=[];errors=[];diagnostics=[];checkpoints=[];captures=[];hudSamples=[];segments=[];loading={};settings={};
 phase='loading';functional=null;functionalAt=0;functionalHiddenAt=0;resourceSamples=[];tasks=[];observer=null;support=supportFor(window);overhead={tourCpuMs:0,recorderCpuMs:0,monitorCpuMs:0};panelUpdatedAt=-Infinity;
 pendingCPU=0;last=0;first=0;visibleMs=0;visibleAt=0;presentations=0;longestGap=0;stallAt=0;heartbeat=0;heartbeatAt=0;currentSegment=null;currentDocument=null;bootAttempted=false;
 captureBytes=0;captureCost=0;captureNextMs=0;lastCaptureAt=-Infinity;captureRequest=null;captureJob=false;captureFailure='';hudFPS=null;restoreRuntime=()=>{};hiddenAt=0;loadingHiddenMs=0;
 panel.classList.remove('completed');panel.classList.add('compact');frame.hidden=false;frame.style.pointerEvents='none';
 $('stop').hidden=false;$('results').hidden=true;$('route-progress').hidden=false;$('status').textContent='Φόρτωση παιχνιδιού…';
 listen(document,'visibilitychange',()=>{if(document.hidden)hiddenAt=performance.now();else if(hiddenAt){loadingHiddenMs+=performance.now()-hiddenAt;hiddenAt=0;}note(document.hidden?'hidden':'visible');});
 listen(frame,'load',()=>{if(!active)return;loading.documentLoadedMs=number(elapsed());note('document-loaded');monitor();});
 note('recording-started');previousDocument=frame.contentDocument;frame.src=gameURL.href;
 let diagnosticsAt=0;
 timer=setInterval(()=>{const begin=performance.now();monitor();if(active&&elapsed()-diagnosticsAt>=1000){snapshot();resourceSnapshot('periodic');diagnosticsAt=elapsed();}overhead.monitorCpuMs+=performance.now()-begin;},100);
 listen(window,'resize',positionPanel);
}
function finish(outcome='stopped'){
 if(!active)return;
 const finalState=snapshot();closeSegment();active=false;clearInterval(timer);timer=null;tour?.stop();functional?.stop();observer?.close();frame.style.pointerEvents='auto';
 if(game)frame.contentWindow.cancelAnimationFrame(heartbeatRequest);restoreRuntime();for(const dispose of disposers)dispose();disposers=[];
 const renderer=game?.renderer,canvas=renderer?.webgl.domElement,backend=renderer?.webgl.backend;
 let navigation=null,resources=[];
 try{const perf=frame.contentWindow.performance;navigation=perf.getEntriesByType('navigation')[0]?.toJSON()??null;resources=perf.getEntriesByType('resource').map(e=>({name:e.name,atMs:number(perf.timeOrigin-performance.timeOrigin-startedAt+e.startTime),durationMs:number(e.duration),responseStatus:e.responseStatus??null,transferSize:e.transferSize,encodedBodySize:e.encodedBodySize})).sort((a,b)=>b.durationMs-a.durationMs).slice(0,20);const fcp=perf.getEntriesByName('first-contentful-paint')[0];if(fcp)loading.firstContentfulPaintMs=number(perf.timeOrigin-performance.timeOrigin-startedAt+fcp.startTime);}catch{}
 const byArea=Object.fromEntries([...new Set(samples.map(s=>s.area))].map(name=>[name,stats(samples.filter(s=>s.area===name).map(s=>s.frameMs))]));
 report={schema:4,recorderVersion:RECORDER_VERSION,support,coverage:coverage(checkpoints),visitComparison:compareVisits(samples),resourceSamples,mainThread:{support:support.longTasks,tasks},functional:{expectedChecks:6,method:'Controlled simulation input and game lifecycle checks, after performance measurement',checks:functional?.checks??[],complete:functional?.complete??false},overhead:{...Object.fromEntries(Object.entries(overhead).map(([k,v])=>[k,number(v)])),captureCpuMs:number(captureCost),note:'Measured recorder CPU portions; not total browser overhead or isolated GPU time. Raw frame intervals retain overhead.'},createdAt:new Date().toISOString(),outcome,gameURL:gameURL.href,buildScripts:[...frame.contentDocument?.querySelectorAll('script[src]')??[]].map(s=>s.src),device:{userAgent:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight},devicePixelRatio,canvas:canvas?{width:canvas.width,height:canvas.height}:null,backend:backend?(backend.isWebGLBackend?'WebGL2':'WebGPU'):null},settings,loading:{...loading,hiddenMs:number(loadingHiddenMs),navigation,slowestResources:resources},durationMs:number(elapsed()),visiblePlayingMs:number(visibleMs),effectiveFPS:visibleMs?number(presentations*1000/visibleMs):null,longestPresentationGapMs:number(longestGap),worst500ms:worstWindow(segments,500),worst1000ms:worstWindow(segments,1000),hud:{minFPS:hudSamples.length?Math.min(...hudSamples.map(s=>s.fps)):null,samples:hudSamples},tour:{completed:!!tour&&tour.index===tour.total,reached:tour?.index??0,total:tour?.total??0,checkpoints},finalState,diagnostics,method:'Successful scene submissions, not isolated GPU completion. Raw intervals include labelled thumbnail overhead. Fixed 500/1000ms windows include no-frame tails. Background and paused segments are excluded. HUD FPS values use the actual game counter. Automatic tour uses normal player physics and collisions. Loading starts before iframe navigation; timings include this visit’s cache state.',frames:stats(samples.map(s=>s.frameMs)),cpu:stats(samples.map(s=>s.cpuMs)),byArea,errors:[...errors,...renderer?.renderError?[renderer.renderError]:[]],events,samples,slowestFrames:[...samples].sort((a,b)=>b.frameMs-a.frameMs).slice(0,20),slowFrames:samples.filter(s=>s.frameMs>=50),captures,capture:{count:captures.length,encodedBytes:captureBytes,totalCpuMs:number(captureCost),unavailable:captureFailure,limits:{width:320,images:18,bytes:3*1024*1024,minimumGapMs:3000}}};
 report.findings=diagnose(report);
 // Measurement is finished; stop scene work while the evidence is reviewed.
 game?.suspendLifecycle();
 if(!game){frame.removeAttribute('src');frame.hidden=true;}
 renderReport(report);persist(report).catch(error=>{$('capture-status').textContent+=' Η μόνιμη αποθήκευση δεν επιτράπηκε· χρησιμοποίησε Λήψη αναφοράς.';});
}
function renderReport(value){
 panel.classList.remove('compact');panel.classList.add('completed');$('stop').hidden=true;$('begin').hidden=false;$('begin').textContent='ΝΕΟ BENCHMARK';$('results').hidden=false;for(const id of ['download','share','copy'])$(id).hidden=false;
 const messages={completed:'Η αυτόματη διαδρομή ολοκληρώθηκε.',stopped:'Το benchmark διακόπηκε. Αποθηκεύτηκαν όσα μετρήθηκαν.',blocked:'Η διαδρομή εμποδίστηκε. Η θέση και οι συγκρούσεις καταγράφηκαν.','load-failed':'Η φόρτωση απέτυχε. Αποθηκεύτηκε η διάγνωση.','load-timeout':'Η φόρτωση δεν ολοκληρώθηκε. Αποθηκεύτηκε η διάγνωση.','render-stalled':'Το παιχνίδι σταμάτησε να δίνει νέα καρέ.','capacity-limit':'Συμπληρώθηκε το όριο δειγμάτων. Η διαδρομή είναι ημιτελής.','unsupported-route':'Η αυτόματη διαδρομή υποστηρίζει το αρχικό mansion.'};
 $('status').textContent=messages[value.outcome]??value.outcome;
 if(value.outcome==='functional-timeout')$('status').textContent='Οι λειτουργικοί έλεγχοι δεν ολοκληρώθηκαν εγκαίρως. Η αναφορά διατηρήθηκε.';
 if(value.outcome==='completed'&&value.functional?.checks.some(c=>c.status==='failed'))$('status').textContent='Η διαδρομή ολοκληρώθηκε με αποτυχία σε λειτουργικό έλεγχο. Δες τα ευρήματα.';
 const s=value.frames,load=value.loading;
 $('capabilities').textContent=value.support?`Εργασίες κύριου νήματος: ${value.support.longTasks==='available'?'διαθέσιμες':'μη διαθέσιμες'} · JS heap: ${value.support.jsHeap==='available-estimate'?'εκτίμηση browser':'μη διαθέσιμο'}. Χρόνος GPU, RAM και VRAM: μη διαθέσιμα.`:'';
 const findingList=$('findings');findingList.replaceChildren();
 for(const f of value.findings??[]){const item=document.createElement('li');item.textContent=`${f.severity==='critical'?'Σοβαρό':'Προσοχή'} · ${f.title}${f.evidence?.checkpoint?' · '+f.evidence.checkpoint:''}${f.evidence?.atMs!=null?' · '+number(f.evidence.atMs/1000)+' s':''} (${f.confidence==='observed'?'παρατήρηση':f.confidence==='correlated'?'ένδειξη':'άγνωστη αιτία'})`;findingList.append(item);}
 $('coverage').textContent=value.coverage?`Δωμάτια: ${value.coverage.verifiedRooms}/${value.coverage.expectedRooms} ελεγμένα και στα δύο περάσματα · ${value.coverage.missing.length} επισκέψεις εκκρεμούν. Λειτουργικοί έλεγχοι: ${(value.functional?.checks??[]).filter(c=>c.status==='passed').length}/${value.functional?.expectedChecks??value.functional?.checks?.length??0}.`: 'Προηγούμενη έκδοση αναφοράς· εκτέλεσε νέο benchmark για κάλυψη δωματίων και διαγνωστικούς ελέγχους.';
 const visits=$('visits');visits.replaceChildren();for(const v of value.visitComparison??[]){const row=document.createElement('tr');for(const text of [v.label,...v.passes.map(p=>p.frames?`${p.frames.fps} FPS · P95 ${p.frames.p95Ms} ms`:'Δεν μετρήθηκε')]){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}visits.append(row);}
 $('summary').textContent=`Μενού: ${load.menuVisibleMs==null?'μη διαθέσιμο':number(load.menuVisibleMs/1000)+' s'} · READY: ${load.readyMs==null?'μη διαθέσιμο':number(load.readyMs/1000)+' s'}\nΠρώτο καρέ παιχνιδιού: ${load.firstGameFrameMs==null?'μη διαθέσιμο':number(load.firstGameFrameMs/1000)+' s'}\n`+(s?`${value.effectiveFPS} FPS συνολικά · ${s.count} διαστήματα καρέ\nΕλάχιστα στιγμιαία: ${s.minInstantFPS} FPS · HUD: ${value.hud.minFPS??'μη διαθέσιμο'} FPS\nΧειρότερο 1 s: ${value.worst1000ms?.fps??'μη διαθέσιμο'} FPS\nP95: ${s.p95Ms} ms · P99: ${s.p99Ms??'—'} ms · μέγιστο: ${s.maxMs} ms\n${s.over50ms} καρέ πάνω από 50 ms\nCPU παιχνιδιού: P95 ${value.cpu.p95Ms} ms · μέγιστο ${value.cpu.maxMs} ms\nΜεγαλύτερο διάστημα χωρίς νέο καρέ: ${number(value.longestPresentationGapMs/1000)} s`:'Χωρίς καρέ παιχνιδιού. Η φόρτωση και τα σφάλματα καταγράφηκαν.');
 $('rows').replaceChildren();for(const [name,s] of Object.entries(value.byArea)){const row=document.createElement('tr');for(const text of [name,`${s.fps} / ${s.minInstantFPS}`,`${s.p95Ms} / ${s.maxMs} ms`]){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}$('rows').append(row);}
 $('capture-status').textContent=value.capture.unavailable?`Λήψη εικόνων μη διαθέσιμη: ${value.capture.unavailable}`:`${value.captures.length} εικόνες · μετρημένο κόστος λήψεων ${value.capture.totalCpuMs} ms συνολικά.`;
 $('captures').replaceChildren();for(const c of value.captures){const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');img.src=c.dataURL;img.alt=`${c.reason} · ${c.area}`;caption.textContent=`${c.area} · ${number(c.atMs/1000)} s · ${c.frameMs?c.frameMs+' ms':c.reason}`;figure.append(img,caption);$('captures').append(figure);}
}
async function database(){return new Promise((resolve,reject)=>{const request=indexedDB.open('electrical-game-benchmark',1);request.onupgradeneeded=()=>request.result.createObjectStore('reports');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function persist(value){const db=await database();try{await new Promise((resolve,reject)=>{const tx=db.transaction('reports','readwrite');tx.objectStore('reports').put(value,'last');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
function reportFile(){return new File([JSON.stringify(report,null,2)],`electrical-game-benchmark-${report.createdAt.replace(/[:.]/g,'-')}.json`,{type:'application/json'});}
function download(){if(!report)return;const file=reportFile(),url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
$('begin').onclick=start;$('stop').onclick=()=>finish('stopped');$('close').onclick=()=>{if(active)finish('stopped');location.assign(gameURL.href);};$('download').onclick=download;
$('share').onclick=async()=>{
 if(!report)return;
 const file=reportFile(),textFile=new File([JSON.stringify(report,null,2)],file.name.replace('.json','.txt'),{type:'text/plain'});
 const files=[textFile,...report.captures.map((c,i)=>{const bytes=Uint8Array.from(atob(c.dataURL.split(',')[1]),v=>v.charCodeAt(0));return new File([bytes],`benchmark-${i+1}-${Math.round(c.atMs)}ms.jpg`,{type:'image/jpeg'});})];
 if(navigator.canShare?.({files})){try{await navigator.share({files,title:'Electrical-Game benchmark'});$('status').textContent='Η κοινοποίηση παραδόθηκε στον browser.';return;}catch(error){if(error.name==='AbortError')return;}}
 $('status').textContent='Η κοινοποίηση αρχείων δεν υποστηρίζεται εδώ. Γίνεται λήψη της πλήρους αναφοράς με τις εικόνες.';download();
};
$('copy').onclick=async()=>{if(!report)return;try{await navigator.clipboard.writeText(`${navigator.userAgent}\n${report.device.backend??'μη διαθέσιμο'} · ${report.device.canvas?.width??'?'}×${report.device.canvas?.height??'?'}\nΈκδοση: ${report.buildScripts.join(', ')}\n${$('summary').textContent}\nΔιαδρομή: ${report.outcome} · ${report.tour.reached}/${report.tour.total}\n${Object.entries(report.byArea).map(([name,s])=>`${name}: ${s.fps} FPS, ελάχιστο ${s.minInstantFPS}, P95 ${s.p95Ms}ms, max ${s.maxMs}ms`).join('\n')}\nΑργότερα καρέ: ${JSON.stringify(report.slowestFrames)}\nΕυρήματα: ${JSON.stringify(report.findings)}\nΚάλυψη: ${JSON.stringify(report.coverage)}\nΛειτουργικοί έλεγχοι: ${JSON.stringify(report.functional)}\nΔιάγνωση: ${JSON.stringify(report.finalState)}\nΣφάλματα: ${JSON.stringify(report.errors)}`);$('status').textContent='Οι αριθμοί και η διάγνωση αντιγράφηκαν.';}catch{$('status').textContent='Η αντιγραφή δεν επιτράπηκε. Χρησιμοποίησε Λήψη αναφοράς.';}};
// Inspectable acceptance hooks; no generated performance measurements.
window.performanceRecording={start,finish,get report(){return report;},get active(){return active;},get phase(){return phase;},get tour(){return tour?{index:tour.index,total:tour.total,current:tour.current}:null;}};
window.render_game_to_text=()=>JSON.stringify({mode:active?'benchmark':report?'results':'prompt',phase,functionalChecks:functional?.checks.map(c=>({id:c.id,status:c.status}))??[],status:$('status').textContent,loading,tour:window.performanceRecording.tour,frames:samples.length,coordinates:'Game world metres: x east, y up, z north; the tour uses normal movement and collision.',game:game?JSON.parse(frame.contentWindow.render_game_to_text()):null});
database().then(db=>{const request=db.transaction('reports').objectStore('reports').get('last');request.onsuccess=()=>{if(request.result&&!active&&!report&&run===0){report=request.result;renderReport(report);$('status').textContent='Η προηγούμενη αναφορά διατηρήθηκε στη συσκευή. Πάτησε ΝΕΟ BENCHMARK για νέα μέτρηση.';}db.close();};request.onerror=()=>db.close();}).catch(()=>{});
