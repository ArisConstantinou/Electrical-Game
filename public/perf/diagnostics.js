import {number,stats} from './metrics.js?v=diagnostics-4.0.1';
import {inspectionManifest} from './tour.js?v=diagnostics-4.0.1';
export const RECORDER_VERSION='4.0.1';
export function appendResourceSnapshot(rows,sample,limit=1024){
 if(rows.length>=limit){if(sample.kind==='periodic')return false;const index=rows.findIndex(s=>s.kind==='periodic');if(index<0)return false;rows.splice(index,1);}
 rows.push(sample);return true;
}
export function coverage(checkpoints){
 const spaces=inspectionManifest().map(room=>({...room,passes:[1,2].map(pass=>({pass,visited:checkpoints.some(c=>c.roomId===room.roomId&&c.pass===pass&&c.verified===true)}))}));
 return {expectedRooms:spaces.filter(s=>s.room).length,expectedSpaces:spaces.length,verifiedRooms:spaces.filter(s=>s.room&&s.passes.every(p=>p.visited)).length,complete:spaces.every(s=>s.passes.every(p=>p.visited)),spaces,missing:spaces.flatMap(s=>s.passes.filter(p=>!p.visited).map(p=>({roomId:s.roomId,label:s.label,pass:p.pass})))};
}
export function compareVisits(samples){
 return inspectionManifest().map(room=>{
  const passes=[1,2].map(pass=>{const rows=samples.filter(s=>s.roomId===room.roomId&&s.pass===pass&&s.inspectionSweep&&s.phase==='performance');return {pass,frames:stats(rows.map(s=>s.frameMs)),cpu:stats(rows.map(s=>s.cpuMs)),renderSubmission:stats(rows.map(s=>s.renderCpuMs)),resources:rows.length?{geometries:rows.at(-1).geometries,textures:rows.at(-1).textures}:null};});
  const [a,b]=passes;return {roomId:room.roomId,label:room.label,passes,p95ChangeMs:a.frames&&b.frames?number(b.frames.p95Ms-a.frames.p95Ms):null,interpretation:!a.frames||!b.frames?'incomplete':b.frames.p95Ms<a.frames.p95Ms*.8?'second-visit-faster':'persistent-or-variable',note:'Same room and camera sweep; resource warmup, thermal state and background work can all change the second visit.'};
 });
}
export function diagnose(report){
 const findings=[];
 const add=(type,severity,title,evidence,confidence='observed')=>findings.push({type,severity,title,confidence,evidence});
 if(['load-failed','load-timeout','render-stalled'].includes(report.outcome))add(report.outcome,'critical',report.outcome==='render-stalled'?'Το rendering σταμάτησε':'Η φόρτωση δεν ολοκληρώθηκε',{outcome:report.outcome,loading:report.loading});
 for(const error of report.errors)add('error','critical','Σφάλμα παιχνιδιού / φόρτωσης',{message:error});
 for(const e of report.events.filter(e=>['webglcontextlost','graphics-lost','tour-blocked','rendering-stalled','capture-budget-exceeded'].includes(e.type)))add(e.type,e.type==='capture-budget-exceeded'?'warning':'critical',e.type==='capture-budget-exceeded'?'Η λήψη εικόνας επιβάρυνε τη δοκιμή':e.type==='tour-blocked'?'Εμπόδιο στην αυτόματη διαδρομή':e.type==='rendering-stalled'?'Δεν υποβλήθηκαν νέα καρέ':'Απώλεια γραφικών',e);
 for(const s of [...report.samples].filter(s=>s.phase==='performance'&&s.frameMs>=50).sort((a,b)=>b.frameMs-a.frameMs).slice(0,40)){
  const tasks=(report.mainThread.tasks??[]).filter(t=>t.atMs<s.atMs&&t.atMs+t.durationMs>s.atMs-s.frameMs);
  const nearby=(report.diagnostics??[]).filter(d=>d.atMs<=s.atMs&&d.atMs>=s.atMs-1500).at(-1);
  const captureMs=(s.captureCpuMs??0)+(s.previousCaptureCpuMs??0);
  const cause=captureMs>=s.frameMs*.3?'capture-overhead':s.cpuMs>=s.frameMs*.65?'cpu-heavy':tasks.length?'main-thread-blocking':'unresolved-frame-delay';
  add(cause,s.frameMs>=250?'critical':'warning',cause==='cpu-heavy'?'Μεγάλος χρόνος CPU παιχνιδιού':cause==='capture-overhead'?'Καθυστέρηση με κόστος λήψης εικόνας':cause==='main-thread-blocking'?'Καθυστέρηση με εργασία στο κύριο νήμα':'Καθυστέρηση καρέ · αιτία μη επιβεβαιωμένη',{atMs:s.atMs,frameMs:s.frameMs,cpuMs:s.cpuMs,renderCpuMs:s.renderCpuMs,roomId:s.roomId,checkpoint:s.checkpoint,area:s.area,pass:s.pass,position:s.position,yaw:s.yaw,pitch:s.pitch,drawCalls:s.drawCalls,triangles:s.triangles,shadowRequested:s.shadowRequested,captureMs,longTasks:tasks.map(t=>({atMs:t.atMs,durationMs:t.durationMs})),nearbyRenderer:nearby?{atMs:nearby.atMs,...nearby.renderer}:null,loadingResources:(report.loading?.slowestResources??[]).filter(r=>r.atMs<s.atMs&&r.atMs+r.durationMs>s.atMs-s.frameMs),capture:report.captures.find(c=>Math.abs((c.sourceAtMs??c.atMs)-s.atMs)<250)?.atMs??null},cause==='unresolved-frame-delay'?'unknown':'correlated');
 }
 const endpoint=report.resourceSamples.filter(s=>s.kind==='pass-end');
 if(endpoint.length===2){const delta={geometries:endpoint[1].geometries-endpoint[0].geometries,textures:endpoint[1].textures-endpoint[0].textures,heapBytes:endpoint.every(s=>s.heapBytes!=null)?endpoint[1].heapBytes-endpoint[0].heapBytes:null};if(delta.geometries>0||delta.textures>0)add('resource-growth','warning','Οι πόροι αυξήθηκαν μετά το δεύτερο πέρασμα',{before:endpoint[0],after:endpoint[1],delta,note:'Two visits establish growth, not a confirmed memory leak. Lazy loading and garbage collection remain possible.'},'correlated');}
 if(!report.coverage.complete)add('coverage','warning','Η επιθεώρηση χώρων δεν ολοκληρώθηκε',{missing:report.coverage.missing});
 if(!report.functional.complete&&report.functional.expectedChecks)add('functional-incomplete','warning','Οι λειτουργικοί έλεγχοι δεν ολοκληρώθηκαν',{completed:report.functional.checks.length,expected:report.functional.expectedChecks});
 for(const check of report.functional.checks??[])if(check.status==='failed')add('functional-failure','critical',`Αποτυχία: ${check.label}`,check);
 return findings.slice(0,100);
}
export function supportFor(win){
 const types=win.PerformanceObserver?.supportedEntryTypes??[];
 return {longTasks:types.includes('longtask')?'available':'unavailable',jsHeap:win.performance.memory?'available-estimate':'unavailable',gpuTime:'unavailable',ramBytes:'unavailable',vramBytes:'unavailable',visualGlitchDetection:'manual-review-of-captures',inputLatency:'controlled-action-to-simulation-response; not physical touch-to-display latency'};
}
