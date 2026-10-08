// Run existing gameplay checks against an isolated build on the sole project
// origin, with bounded cleanup and a verified owned-browser process tree.
import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';import {routeBuildingDist} from './building-qa-utils.mjs';
const helper=path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'skills/develop-web-game/scripts/browser_lifecycle.mjs');
const {launchManagedBrowser,runManagedClient}=await import(pathToFileURL(helper).href);
const file=process.argv[2];if(!file)throw Error('Usage: node tests/managed-game-regression.mjs <test-file> [test-arguments]');
const args=process.argv.slice(3),out=path.resolve(process.env.QA_MANAGED_OUT??'output/managed-regressions',path.basename(file,'.mjs'));
await mkdir(out,{recursive:true});
let session;chromium.launch=async options=>{
 if(session)throw Error('This wrapper supports one browser launch per regression');
 session=await launchManagedBrowser(chromium,{...options,screenshotDir:out});const b=session.browser;
 const context=b.newContext.bind(b);b.newContext=async(...a)=>{const c=await context(...a);await routeBuildingDist(c);return c;};
 const page=b.newPage.bind(b);b.newPage=async(...a)=>{const p=await page(...a);await routeBuildingDist(p.context());return p;};return b;
};
process.argv=[process.execPath,path.resolve(file),...args];
// The import starts the existing script and its launch; wait until that handle
// exists before handing the whole script's lifetime to the ownership guard.
const task=import(pathToFileURL(path.resolve(file)).href);let settled=false;task.finally(()=>settled=true).catch(()=>{});
while(!session&&!settled)await new Promise(r=>setTimeout(r,10));
if(session)await runManagedClient(session,600000,()=>task);else await task;
