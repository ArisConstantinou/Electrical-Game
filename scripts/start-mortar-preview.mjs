import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// Resolve the checkout from this file, never the terminal's working directory.
// A shared node_modules directory does not identify the game being served.
const root=fileURLToPath(new URL('../',import.meta.url));
const url='http://127.0.0.1:5364/Electrical-Game/';
const normalize=s=>s.replace(/\r\n/g,'\n');
async function main(){
let occupied=false;
try{await fetch(url,{signal:AbortSignal.timeout(2000)});occupied=true;}
catch(error){if(error.cause?.code!=='ECONNREFUSED')throw error;}
if(occupied){
 for(const file of ['src/player/PlayerController.ts','src/core/Game.ts','src/systems/MixingStation.ts']){
  const response=await fetch(url+file,{signal:AbortSignal.timeout(3000)}),body=await response.text();
  const encoded=body.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/)?.[1];
  const served=encoded?JSON.parse(Buffer.from(encoded,'base64').toString()).sourcesContent?.[0]:null;
  if(!response.ok||typeof served!=='string'||normalize(served)!==normalize(await readFile(path.join(root,file),'utf8'))){
   throw new Error(`Port 5364 serves different source (${file}). Identify and stop that listener before restarting this preview. No process was stopped. Expected checkout: ${root}`);
  }
 }
 console.log(`Verified existing mortar preview: ${url}\nCheckout: ${root}`);
}else{
 const require=createRequire(import.meta.url),vite=path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js');
 console.log(`Starting mortar preview: ${url}\nCheckout: ${root}`);
 const child=spawn(process.execPath,[vite,root,'--host','127.0.0.1','--port','5364','--strictPort'],{cwd:root,stdio:'inherit',windowsHide:true});
 child.on('error',error=>{console.error(error);process.exitCode=1;});
 child.on('exit',code=>{process.exitCode=code??1;});
}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
