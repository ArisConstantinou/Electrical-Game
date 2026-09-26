import path from 'node:path';
import { readFile } from 'node:fs/promises';
export async function routeBuildingDist(context,root=path.resolve(process.env.QA_DIST_ROOT??'dist')) {
 if(process.env.QA_LIVE==='1')return; // Explicit final check of the real listener.
 const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.glb':'model/gltf-binary','.wasm':'application/wasm'};
 await context.route('http://127.0.0.1:5365/Electrical-Game/**',async route=>{
  const file=path.resolve(root,decodeURIComponent(new URL(route.request().url()).pathname).slice('/Electrical-Game/'.length)||'index.html');
  if(!file.startsWith(root+path.sep))return route.abort();
  try{await route.fulfill({body:await readFile(file),contentType:mime[path.extname(file)]??'application/octet-stream'});}catch{await route.fulfill({status:404,body:'Missing '+path.basename(file)});}
 });
}
