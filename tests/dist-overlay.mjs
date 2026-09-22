import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary'};

// Exercise this worktree's production build in the existing 5365 browser tab.
// This changes only the test browser's responses; the shared listener stays put.
export async function installDistOverlay(page){
  await page.route('http://127.0.0.1:5365/Electrical-Game/**',async route=>{
    const pathname=new URL(route.request().url()).pathname.slice('/Electrical-Game/'.length);
    const relative=pathname||'index.html';
    if(relative.includes('..'))return route.abort();
    const file=path.join(root,'dist',relative);
    try{const body=await readFile(file);await route.fulfill({status:200,body,contentType:mime[path.extname(file)]??'application/octet-stream'});}
    catch{return route.continue();}
  });
}
