import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createServer} from 'vite';
// CPU paint-command/texture invalidation check; no renderer or physical input.
globalThis.document={createElementNS(){return {addEventListener(){},removeEventListener(){},set src(value){}};}};
const server=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom',logLevel:'error'});
try {
 const{BrickWall}=await server.ssrLoadModule('/src/world/BrickWall.ts');
 const wall=Object.create(BrickWall.prototype),commands=[];
 wall.paintCount=0;wall.texture=new THREE.CanvasTexture({width:2048,height:1024});
 wall.paint=new Proxy({},{get(target,key){return target[key]??((...args)=>commands.push([key,...args]));},set(target,key,value){target[key]=value;commands.push([key,value]);return true;}});
 const point=new THREE.Vector3(.3,1.2,-2.41),start=wall.texture.version;
 for(let i=0;i<100;i++)wall.clearPaint(point,.045);
 assert.equal(wall.texture.version,start,'blank canvas triggered redundant uploads');assert.deepEqual(commands,[]);
 wall.aim=()=>({point});wall.samples=new Map();wall.lastCoverage=new Map();wall.lastPaintPoint=null;
 wall.spray({},'A');assert.equal(wall.paintCount,1);assert.equal(wall.texture.version,start+1);assert(commands.some(c=>c[0]==='stroke'));
 commands.length=0;wall.clearPaint(point,.045);
 assert.equal(wall.texture.version,start+2,'painted canvas was not uploaded after erasing');
 assert(commands.some(c=>c[0]==='globalCompositeOperation'&&c[1]==='destination-out'));assert(commands.some(c=>c[0]==='arc'));assert(commands.some(c=>c[0]==='fill'));
 console.log(JSON.stringify({passed:true,blankBlows:100,blankUploads:0,paintUpload:1,eraseUpload:1}));
}finally{await server.close();delete globalThis.document;}
