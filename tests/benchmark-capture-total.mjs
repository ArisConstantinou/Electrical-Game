import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const source=await readFile('public/perf/recorder.js','utf8');
const start=source.indexOf('function copyCapture('),end=source.indexOf('function installRuntime(',start);assert(start>=0&&end>start);
const production=source.slice(start,end);
function probe(body,snapshotMs,encodingMs){
 let clock=0;const context={active:true,game:{renderer:{webgl:{domElement:{width:32,height:32}}},player:{camera:{position:{toArray:()=>[0,1.65,2]}},yaw:0,pitch:0}},captureFailure:'',lastCaptureAt:-Infinity,captureCost:0,captureNextMs:0,captureBytes:0,captures:[],events:[],tour:{current:{label:'Unit fixture'}},number:v=>Math.round(v*10)/10,elapsed:()=>10000,area:()=> 'Unit fixture',performance:{now:()=>clock},document:{createElement:()=>({width:0,height:0,getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(4096).fill(180)})}),toDataURL:()=>{clock+=encodingMs;return 'test-only-data';}})}};
 context.note=(type,detail)=>context.events.push({type,detail});vm.createContext(context);
 vm.runInContext(body+`;copyCapture('Unit fixture',0,null,{width:32,height:32},{snapshotCpuMs:${snapshotMs}});`,context);
 return {blocked:!!context.captureFailure,combinedMs:context.captures[0].captureCpuMs,events:context.events};
}
// Model only the measured CPU portions, not browser/GPU performance. Execute
// the actual production function, including image accounting and warning.
const combined=probe(production,20,20),under=probe(production,10,15),encoder=probe(production,0,40);
assert(combined.blocked);assert.equal(combined.combinedMs,40);assert(!under.blocked);assert(encoder.blocked);
const protectedRule=production.replace('if(totalCost>32&&!captureFailure)','if(cost>32&&!captureFailure)');assert.notEqual(protectedRule,production);
const before=probe(protectedRule,20,20);assert(!before.blocked,'Previous per-portion rule misses this combined-cost case');
const report={passed:true,method:'Actual production copyCapture function with controlled CPU clock; not performance evidence',before,after:combined,under,encoder};await mkdir('output/benchmark-capture-total',{recursive:true});await writeFile('output/benchmark-capture-total/unit-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,beforeBlocked:before.blocked,afterBlocked:combined.blocked,combinedMs:combined.combinedMs}));
