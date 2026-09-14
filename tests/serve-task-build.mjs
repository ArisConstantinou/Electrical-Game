import {readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import assert from 'node:assert/strict';

/** Validate exact compiled files on the existing origin without another server. */
export async function serveTaskBuild(context,base){
  if(!process.env.TASK_BUILD_ROOT)return;
  const directory=resolve(process.env.TASK_BUILD_ROOT),origin=new URL(base);
  const prefix=origin.pathname.endsWith('/')?origin.pathname:origin.pathname+'/';
  await context.route(origin.origin+prefix+'**',async route=>{
    const relative=decodeURIComponent(new URL(route.request().url()).pathname.slice(prefix.length))||'index.html';
    const path=resolve(directory,relative);assert(path.startsWith(directory+sep));
    const contentType=path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.html')?'text/html':path.endsWith('.png')?'image/png':'application/octet-stream';
    await route.fulfill({status:200,contentType,body:await readFile(path)});
  });
}
