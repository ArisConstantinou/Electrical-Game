export const number = value => Math.round(value * 10) / 10;
export function stats(values) {
 if (!values.length) return null;
 const sorted = [...values].sort((a,b)=>a-b), mean = values.reduce((a,b)=>a+b,0)/values.length;
 return {count:values.length,meanMs:number(mean),fps:number(1000/mean),minInstantFPS:number(1000/sorted.at(-1)),p95Ms:number(sorted[Math.ceil(sorted.length*.95)-1]),p99Ms:number(sorted[Math.ceil(sorted.length*.99)-1]),maxMs:number(sorted.at(-1)),over50ms:values.filter(v=>v>50).length,over100ms:values.filter(v=>v>100).length,over250ms:values.filter(v=>v>250).length,over60fpsBudget:values.filter(v=>v>1000/60+.5).length};
}
// Fixed windows include zero-frame windows and an unfinished frozen tail.
// Visibility/lifecycle transitions start a new segment; background time is excluded.
export function worstWindow(segments, widthMs) {
 let worst = null;
 for (const {start,end,times} of segments) {
  if (end-start < widthMs) continue;
  const candidates = [start,end-widthMs,...times.map(t=>t+.01).filter(t=>t+widthMs<=end)];
  let left=0,right=0;
  for (const from of candidates.sort((a,b)=>a-b)) {
   while(left<times.length&&times[left]<=from)left++;
   if(right<left)right=left;
   while(right<times.length&&times[right]<=from+widthMs)right++;
   const count=right-left;
   if(!worst||count<worst.frames)worst={startMs:number(from),endMs:number(from+widthMs),frames:count,fps:number(count*1000/widthMs)};
  }
 }
 return worst;
}
