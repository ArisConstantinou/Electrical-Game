import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';

// Run browser checks serially: simultaneous WebGL/WebGPU pages would distort
// the performance measurements and compete for the user's GPU.
const out='output/building-acceptance';await mkdir(out,{recursive:true});
const cases=[
 ['jump-animation','building-jump-animation.mjs',[]],
 ['foyer-entry','building-foyer-entry.mjs',[]],
 ['hammer-desktop','../scripts/forge-hammer-wrist-qa.mjs',['final-performance-desktop']],
 ['hammer-mobile','../scripts/forge-hammer-wrist-qa.mjs',['final-performance-mobile'],{QA_MOBILE:'1'}],
 ['visuals','building-review.mjs',['final','--visual-only']],
 ['surfaces-and-work','building-contract.mjs',[]],
 ['demolition','mansion-masonry-demolition.mjs',[]],
 ['chase-desktop','mansion-masonry-chase.mjs',[]],
 ['chase-mobile','mansion-masonry-chase.mjs',['--mobile']],
 ['held-input','mansion-hammer-input.mjs',[]],
 ['window','exterior-window-ui.mjs',[]],
 ['skill-client','building-skill-smoke.mjs',[]],
 ['measure','height-measure-ui.mjs',[]],
 ['laser','laser-level-ui.mjs',[]],
 ['circulation-soak','building-circulation-native.mjs',[]],
 ['mobile-work','mobile-work-profile.mjs',[]],
 ['mixing-work','mixer-work-profile.mjs',[]],
 ['phone-resume','phone-resume-ui.mjs',[]],
 ['performance','building-performance.mjs',[]],
];
const selected=process.argv.slice(2);
const report=selected.length?JSON.parse(await readFile(`${out}/report.json`,'utf8').catch(()=>'[]')):[];
for(const [name,file,args,env] of cases){
 if(selected.length&&!selected.includes(name))continue;
 const start=Date.now();let output='';
 const child=spawn(process.execPath,[`tests/${file}`,...args],{env:{...process.env,QA_DIST_ROOT:path.resolve('dist'),TASK_BUILD_ROOT:path.resolve('dist'),...env},windowsHide:true});
 child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
 const code=await new Promise(resolve=>child.on('close',resolve));
 await writeFile(`${out}/${name}.log`,output);
 const previous=report.findIndex(r=>r.name===name);if(previous>=0)report.splice(previous,1);
 report.push({name,passed:code===0,exitCode:code,elapsedMs:Date.now()-start,log:`${out}/${name}.log`});
 await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report.at(-1)));
 if(code!==0){process.exitCode=1;break;}
}
