import {number} from './metrics.js?v=diagnostics-4.0.2';
import {supportFor} from './diagnostics.js?v=diagnostics-4.0.2';
export function observeMainThread(win,timeOrigin,phase,rows){
 const support=supportFor(win);let observer=null;
 const append=entries=>{for(const e of entries){if(rows.length>=2000)break;const atMs=win.performance.timeOrigin-timeOrigin+e.startTime;if(atMs>=0)rows.push({atMs:number(atMs),durationMs:number(e.duration),name:e.name,phase:phase()});}};
 if(support.longTasks==='available')try{observer=new win.PerformanceObserver(list=>append(list.getEntries()));observer.observe({type:'longtask',buffered:true});}catch{support.longTasks='unavailable';}
 return {support,close(){if(observer){append(observer.takeRecords());observer.disconnect();observer=null;}}};
}
